import json
from datetime import timedelta
from unittest.mock import patch
import httpx
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.agents.models import AgentSession
from apps.agents.harness import complete
from apps.common.errors import RuleError
from apps.connections.models import ModelConnection
from apps.connections.services import encrypt
from apps.identity.models import Team, Membership


class AgentTests(TestCase):
    def setUp(self):
        self.user=User.objects.create_user('agent-fixture-owner')
        self.team=Team.objects.create(name='agent-fixture')
        Membership.objects.create(user=self.user,team=self.team,role='admin')
        self.api=APIClient();self.api.force_authenticate(user=self.user)
        self.connection=ModelConnection.objects.create(team=self.team,name='Fixture model',protocol='openai-completions',
            model_id='fixture-model',base_url='https://models.example/v1',credential_ciphertext=encrypt('fixture-private-token'))

    def start(self,purpose='assistant'):
        response=self.api.post('/api/v1/agent-sessions',{'purpose':purpose},format='json')
        self.assertEqual(response.status_code,201,response.data)
        return response.data

    def turn(self,session,message='Explain the provided product facts'):
        return self.api.post(f'/api/v1/agent-sessions/{session["id"]}',{'connection_id':str(self.connection.id),
            'expected_revision':session['revision'],'message':message},format='json')

    def transport(self,text):
        actual=httpx.Client
        def handler(request):
            self.assertEqual(request.headers.get('Authorization'),'Bearer fixture-private-token')
            self.assertNotIn('fixture-private-token',request.content.decode())
            return httpx.Response(200,json={'choices':[{'message':{'content':text}}],'usage':{'prompt_tokens':8,'completion_tokens':12}})
        return patch('apps.connections.model_gateway.httpx.Client',side_effect=lambda **kwargs:actual(transport=httpx.MockTransport(handler),**kwargs))

    def test_real_pi_subprocess_with_mock_provider_saves_trace_and_redacts_key(self):
        session=self.start()
        with patch('apps.connections.model_gateway.validate_endpoint',return_value='https://models.example/v1'),self.transport('Advice fixture-private-token'):
            response=self.turn(session)
        self.assertEqual(response.status_code,200,response.data)
        assistant=response.data['messages'][-1]
        self.assertEqual(assistant['content'],'Advice [REDACTED]')
        self.assertEqual(assistant['usage']['harness']['version'],'1.0.4')
        self.assertIn('agent_end',assistant['usage']['harness']['events'])
        self.assertNotIn('fixture-private-token',json.dumps(response.data))
        self.assertEqual(self.api.get(f'/api/v1/agent-sessions/{session["id"]}').data,response.data)
        self.assertEqual(self.turn(session).status_code,409)

    def test_customer_support_has_strict_output_and_no_business_writes(self):
        session=self.start('customer_support')
        answer={'schema_version':'SupportReply@1','reply':'请提供订单编号，我们还没有确认发货。',
            'facts_used':[],'questions':['请提供订单编号'], 'handoff_required':True}
        with patch('apps.connections.model_gateway.validate_endpoint',return_value='https://models.example/v1'),self.transport(json.dumps(answer)):
            response=self.turn(session,'客户问何时到货，未提供查单资料。')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['messages'][-1]['usage']['harness']['purpose'],'customer_support')
        self.assertTrue(response.data['result']['handoff_required'])
        from apps.runtime.models import WorkflowRun
        from apps.teststore.models import PublishedProduct
        self.assertEqual(WorkflowRun.objects.count(),0);self.assertEqual(PublishedProduct.objects.count(),0)
        with patch('apps.connections.model_gateway.validate_endpoint',return_value='https://models.example/v1'),self.transport('我已经退款了'):
            self.assertEqual(self.turn(response.data).status_code,422)
        saved=AgentSession.objects.get(pk=session['id'])
        self.assertEqual(saved.revision,2);self.assertIsNone(saved.busy_until)

    def test_image_plan_does_not_fake_generated_asset(self):
        session=self.start('product_image_plan')
        answer={'schema_version':'ProductImagePlan@1','prompt':'保持原商品形状，白色背景','preserve':['商品颜色'],
            'forbidden_changes':['尺寸比例'],'questions':[]}
        with patch('apps.connections.model_gateway.validate_endpoint',return_value='https://models.example/v1'),self.transport(json.dumps(answer)):
            response=self.turn(session)
        self.assertEqual(response.status_code,200,response.data)
        self.assertNotIn('image_url',response.data['result'])

    def test_no_harness_fallback_when_node_is_missing(self):
        with patch.dict('os.environ',{'COMMERCE_HARNESS_NODE':'/nonexistent/pi-node'}),patch('apps.connections.model_gateway.provider_complete') as provider:
            with self.assertRaises(RuleError):complete(self.connection,'fixed',[{'role':'user','content':'hello'}],purpose='assistant')
        provider.assert_not_called()

    def test_busy_isolation_skill_fingerprint_and_operator_permissions(self):
        session=self.start()
        AgentSession.objects.filter(pk=session['id']).update(busy_until=timezone.now()+timedelta(seconds=60))
        self.assertEqual(self.turn(session).status_code,409)
        AgentSession.objects.filter(pk=session['id']).update(busy_until=None,skill_digest='0'*64)
        self.assertEqual(self.turn(session).status_code,422)
        other=User.objects.create_user('agent-fixture-other');team=Team.objects.create(name='other')
        Membership.objects.create(user=other,team=team,role='viewer');self.api.force_authenticate(user=other)
        self.assertEqual(self.api.get(f'/api/v1/agent-sessions/{session["id"]}').status_code,404)
        self.assertEqual(self.api.post('/api/v1/agent-sessions',{'purpose':'assistant'},format='json').status_code,403)

    def test_runtime_skills_are_separate_from_executable_workflow_registry(self):
        profiles=self.api.get('/api/v1/agent-skills')
        self.assertEqual(profiles.status_code,200)
        self.assertEqual(len(profiles.data),6)
        for item in profiles.data:
            self.assertEqual(item['kind'],'runtime-model-policy');self.assertEqual(item['tools'],[])
            self.assertNotIn('instructions',item)
        self.assertEqual(self.api.post('/api/v1/agent-sessions',{'purpose':'listing.publish'},format='json').status_code,400)
