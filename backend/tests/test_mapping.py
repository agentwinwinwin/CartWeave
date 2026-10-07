import json
from types import SimpleNamespace
from unittest.mock import patch
import httpx
from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.connections.models import ModelConnection, MappingSession
from apps.connections.services import encrypt
from apps.connections.model_gateway import complete, validate_endpoint
from apps.common.errors import RuleError


class MappingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('mapping-owner')
        self.team = Team.objects.create(name='mapping')
        Membership.objects.create(user=self.user,team=self.team,role='admin')
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.connection = ModelConnection.objects.create(team=self.team,name='Model A',protocol='openai-completions',
            model_id='model-a',base_url='https://models.example/v1',credential_ciphertext=encrypt('test-secret'))
        self.answer = {'summary':'需要确认库存含义', 'questions':['qty 是可售量吗？'], 'limitations':[], 'mappings':[
            {'direction':'request','fixed_path':'listing.title','external_path':'name','meaning':'商品标题',
             'conversion':'原样传递','evidence':'用户提供的 /products 文档','status':'direct'}]}

    def start(self, channel='custom-store'):
        r = self.api.post('/api/v1/mappings',{'channel':channel,'action':'listing.publish'},format='json')
        self.assertEqual(r.status_code,201,r.data)
        return r.data

    def test_independent_store_mock_mapping_uses_fixed_fields_and_remains_draft(self):
        s=self.start('test-store')
        answer={'summary':'独立站示例接口价格单位为美分，先转换再提交；记录仍待验收。',
            'questions':[], 'limitations':['此分析尚未生成或注册适配代码。'], 'mappings':[
                {'direction':'request','fixed_path':'listing.title','external_path':'name','meaning':'标题',
                 'conversion':'原样传递','evidence':'模拟文档 POST /products: name 是商品标题','status':'direct'},
                {'direction':'request','fixed_path':'listing.variants[].price','external_path':'variants[].price_minor','meaning':'售价',
                 'conversion':'USD 主单位乘以 100，使用十进制定点数','evidence':'模拟文档明确 price_minor 单位为美分','status':'convert'}]}
        with patch('apps.connections.mapping_views.complete',return_value=(json.dumps(answer),{})):
            r=self.turn(s,message='模拟独立站 POST /products: name 为标题，variants[].price_minor 为 USD 美分。')
        self.assertEqual(r.status_code,200,r.data)
        self.assertEqual(r.data['result']['status'],'draft')
        self.assertEqual(r.data['contract'],s['contract'])
        from apps.teststore.models import PublishedProduct
        self.assertEqual(PublishedProduct.objects.count(),0)

    def test_package_scope_is_system_selected_and_checks_each_action_contract(self):
        response=self.api.post('/api/v1/mappings',{'channel':'test-store'},format='json')
        self.assertEqual(response.status_code,201,response.data)
        session=response.data
        self.assertEqual(session['action'],'store.package')
        self.assertEqual(len(session['contract']['actions']),26)
        self.assertEqual(session['contract']['version'],'1.5.0')
        answer={**self.answer,'mappings':[{**self.answer['mappings'][0],'action':'listing.publish'}]}
        with patch('apps.connections.mapping_views.complete',return_value=(json.dumps(answer),{})) as call:
            result=self.turn(session)
        self.assertEqual(result.status_code,200,result.data)
        self.assertIn('系统已确定完整接入范围',call.call_args.args[1])
        self.assertTrue(any('listing.wait' in item for item in result.data['result']['limitations']))
        for row in [{**answer['mappings'][0],'action':None},{**answer['mappings'][0],'action':'listing.wait'}]:
            with patch('apps.connections.mapping_views.complete',return_value=(json.dumps({**answer,'mappings':[row]}),{})):
                self.assertEqual(self.turn(result.data).status_code,422)

    def test_business_action_mapping_checks_fixed_fields_and_preserves_old_snapshot(self):
        session=self.api.post('/api/v1/mappings',{'channel':'test-store'},format='json').data
        for action,path in [('orders.read','items[].payment_status'),('customers.read','items[].email'),('finance.read','items[].procurement'),('shipments.read','items[].tracking_number'),('order.detail','lines[].sku'),('support.context','result.context_digest'),('materials.save','result.sha256'),('support.message-feed','next_cursor')]:
            answer={'summary':'依据脱敏文档映射，只读资料。','questions':[],'limitations':[], 'mappings':[
                {'action':action,'direction':'response','fixed_path':path,'external_path':path,'meaning':'来源业务字段',
                 'conversion':'明确字段直传；未知保留null','evidence':'测试接口Schema与脱敏响应','status':'direct'}]}
            with patch('apps.connections.mapping_views.complete',return_value=(json.dumps(answer),{})):
                response=self.turn(session)
            self.assertEqual(response.status_code,200,response.data)
            self.assertEqual(response.data['contract'],session['contract'])
            session=response.data
            answer['mappings'][0]['fixed_path']='items[].invented_profit'
            with patch('apps.connections.mapping_views.complete',return_value=(json.dumps(answer),{})):
                self.assertEqual(self.turn(session).status_code,422)

    def test_amazon_mock_exposes_test_store_contract_gaps_instead_of_false_compatibility(self):
        s=self.start('amazon')
        answer={'summary':'Amazon 提交回执不能直接冒充测试站 active 回执。',
            'questions':['商品类型、sellerId、marketplaceId 和品牌/商品标识等必填资料是否完整？'],
            'limitations':['当前固定后端回执只接受 test-store.v1 的 UUID 和 active；Amazon SKU 与 ACCEPTED 不能强行转换，需独立适配契约及可售查询。'],
            'mappings':[{'direction':'response','fixed_path':'status','external_path':'status','meaning':'提交状态，不是可售状态',
                'conversion':'不能将 ACCEPTED 映射为 active；等待 BUYABLE 证据','evidence':'模拟 putListingsItem 返回 ACCEPTED，getListingsItem 尚无 BUYABLE','status':'unsupported'}]}
        with patch('apps.connections.mapping_views.complete',return_value=(json.dumps(answer),{})):
            r=self.turn(s,message='模拟 Amazon putListingsItem: {sku: "mock-hat", status: "ACCEPTED", submissionId: "mock-submission", issues: []}；查询 summaries.status: ["DISCOVERABLE"]。')
        self.assertEqual(r.status_code,200,r.data)
        self.assertEqual(r.data['result']['status'],'draft')
        self.assertEqual(r.data['result']['mappings'][0]['status'],'unsupported')
        from contracts.listings import PublicationReceipt
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            PublicationReceipt.model_validate({'sku':'mock-hat','status':'ACCEPTED','submissionId':'mock-submission','issues':[]})

    def turn(self,s,**kwargs):
        return self.api.post(f'/api/v1/mappings/{s["id"]}',{'connection_id':str(self.connection.id),
            'expected_revision':s['revision'],'message':'name 是商品标题；qty 需要确认',**kwargs},format='json')

    def test_persisted_mapping_and_model_switch_keep_fixed_contract(self):
        s = self.start()
        with patch('apps.connections.mapping_views.complete',return_value=(json.dumps(self.answer),{'input_tokens':10})) as call:
            r = self.turn(s)
            self.assertEqual(r.status_code,200,r.data)
            self.assertIn('映射规则 Skill',call.call_args.args[1])
            self.assertIn('ListingDraft@1',call.call_args.args[1])
            self.assertEqual(r.data['result']['status'],'draft')
            original = s['contract']
            second = ModelConnection.objects.create(team=self.team,name='Model B',protocol='anthropic-messages',
                base_url='https://models.example/v1',model_id='model-b')
            next_r = self.turn(r.data,connection_id=str(second.id),message='qty 是限售量，不是已核实现货')
            self.assertEqual(next_r.status_code,200,next_r.data)
            self.assertEqual(len(call.call_args.args[2]),3)
            self.assertEqual(next_r.data['contract'],original)
            self.assertEqual(next_r.data['messages'][-1]['model'],'model-b')
        self.assertEqual(self.turn(s).status_code,409)

    def test_invalid_model_answer_does_not_change_session(self):
        s = self.start()
        for answer in ['not json',json.dumps({**self.answer,'mappings':[{**self.answer['mappings'][0],'fixed_path':'listing.fake'}]}),
                       json.dumps({**self.answer,'mappings':[{**self.answer['mappings'][0],'evidence':''}]})]:
            with patch('apps.connections.mapping_views.complete',return_value=(answer,{})):
                self.assertEqual(self.turn(s).status_code,422)
            session = MappingSession.objects.get(pk=s['id'])
            self.assertEqual(session.revision,1)
            self.assertEqual(session.messages,[])
            self.assertIsNone(session.busy_until)

    def test_tenant_isolation_and_busy_guard(self):
        s = self.start()
        MappingSession.objects.filter(pk=s['id']).update(busy_until=timezone.now()+timedelta(minutes=1))
        self.assertEqual(self.turn(s).status_code,409)
        other = User.objects.create_user('mapping-other')
        team = Team.objects.create(name='other')
        Membership.objects.create(user=other,team=team,role='admin')
        self.api.force_authenticate(user=other)
        self.assertEqual(self.api.get(f'/api/v1/mappings/{s["id"]}').status_code,404)
        own = self.start()
        self.assertEqual(self.turn(own).status_code,404)
        self.assertEqual(self.api.get('/api/v1/model-connections').data,[])

    def test_model_credentials_are_encrypted_and_not_returned(self):
        fields = {'name':'My model','protocol':'openai-responses','base_url':'https://models.example/v1',
                  'model_id':'custom-model','api_key':'private-api-key'}
        with patch('apps.connections.mapping_views.validate_endpoint',side_effect=lambda url:url):
            r = self.api.post('/api/v1/model-connections',fields,format='json')
            self.assertEqual(r.status_code,201,r.data)
            self.assertNotIn('private-api-key',json.dumps(r.data))
            saved = ModelConnection.objects.get(pk=r.data['id'])
            self.assertNotEqual(saved.credential_ciphertext,'private-api-key')
            update = self.api.put(f'/api/v1/model-connections/{saved.id}',{**fields,'api_key':''},format='json')
            self.assertEqual(update.status_code,200)
            saved.refresh_from_db()
            from apps.connections.services import credential
            self.assertEqual(credential(saved),'private-api-key')

    def test_four_protocol_payloads_and_text_normalization(self):
        actual_client = httpx.Client
        for protocol,reply,suffix in [
            ('openai-completions',{'choices':[{'message':{'content':'answer'}}]},'/chat/completions'),
            ('openai-responses',{'output':[{'content':[{'type':'output_text','text':'answer'}]}]},'/responses'),
            ('anthropic-messages',{'content':[{'type':'text','text':'answer'}]},'/messages'),
            ('google-generative-ai',{'candidates':[{'content':{'parts':[{'text':'answer'}]}}]},':generateContent')]:
            captured = []
            def handler(request):
                captured.append(request)
                return httpx.Response(200,json=reply)
            transport = httpx.MockTransport(handler)
            self.connection.protocol = protocol
            with patch('apps.connections.model_gateway.validate_endpoint',return_value='https://models.example/v1'), patch(
                'apps.connections.model_gateway.httpx.Client',side_effect=lambda **kwargs:actual_client(transport=transport,**kwargs)):
                text,_ = complete(self.connection,'fixed system',[{'role':'user','content':'read fields'}])
            self.assertEqual(text,'answer')
            self.assertTrue(str(captured[0].url).endswith(suffix))
            body = json.loads(captured[0].content)
            self.assertIn('read fields',json.dumps(body))
            self.assertNotIn('test-secret',json.dumps(body))

    @override_settings(LOCAL=True,DESKTOP_MODE=True)
    def test_endpoint_boundaries(self):
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',11434))]):
            self.assertEqual(validate_endpoint('http://localhost:11434/v1'),'http://localhost:11434/v1')
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('169.254.169.254',80))]):
            with self.assertRaises(RuleError): validate_endpoint('http://metadata/v1')
        for url in ['https://key@model.example/v1','https://model.example/v1?api_key=secret']:
            with self.assertRaises(RuleError): validate_endpoint(url)
