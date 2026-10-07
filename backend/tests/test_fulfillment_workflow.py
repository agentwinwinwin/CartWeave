import uuid
from unittest.mock import patch
from django.test import TestCase,LiveServerTestCase,override_settings
from tests.test_business_workflow import BusinessMixin,document
from tests.test_store_testing import StoreTestingTests
from contracts.store_api import ACTION_CONTRACTS,package_contract,mapping_actions
from apps.teststore.models import ExchangeRecord
from apps.commerce.models import BusinessRecord
from httpx import request as real_http_request

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class FulfillmentTests(BusinessMixin,TestCase):
    setUp=StoreTestingTests.setUp
    request=StoreTestingTests.request
    api_call=StoreTestingTests.api_call
    lab=StoreTestingTests.lab
    publish=StoreTestingTests.publish
    def setup_order(self):
        self.store.capabilities=list(ACTION_CONTRACTS);self.store.save(update_fields=['capabilities'])
        self.lab('enable',{'confirmed':True});p=self.publish()
        response=self.lab('test.order.create',{'operation_key':'b'*64,'product_id':str(p.id),'quantity':1,'test_data_confirmed':True})
        self.assertEqual(response.status_code,200,response.data)
        doc=document(self.store,'fulfillment',{'order_id':response.data['id'],'test_execution_confirmed':True})
        doc['environment']['fulfillment']='merchant'
        return response.data['id'],self.freeze(doc)
    def advance(self,run,status):
        s=run.context['business']['shipment']
        r=self.lab('test.shipment.advance',{'shipment_id':s['external_id'],'expected_revision':s['revision'],
            'status':status,'test_data_confirmed':True})
        self.assertEqual(r.status_code,200,r.data)
        return r.data
    def test_eight_steps_wait_for_dispatch_and_delivery_sync_logistics(self):
        order,release=self.setup_order()
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            run=self.start(release)
            for _ in range(3):self.step(run)
            self.assertEqual((run.cursor,run.status),(2,'waiting_approval'))
            self.assertFalse(ExchangeRecord.objects.filter(kind='shipment').exists())
            self.confirm(run);self.step(run);self.step(run)
            self.assertEqual((run.cursor,run.status),(4,'waiting_event'))
            self.advance(run,'dispatched');self.step(run);self.step(run);self.step(run)
            self.assertEqual((run.cursor,run.status),(6,'waiting_event'))
            self.advance(run,'in_transit');self.step(run)
            self.advance(run,'delivered');self.step(run);self.step(run)
            self.assertEqual(run.status,'succeeded')
            self.assertEqual(run.context['business']['receipt']['status'],'delivered')
            self.assertEqual(ExchangeRecord.objects.filter(kind='shipment').count(),1)
            sync=self.api_call(f'stores/{self.store.id}/sync/orders',{})
            self.assertEqual(sync.status_code,200,sync.data)
            row=self.api.get('/api/v1/business/orders').data['results'][0]
            self.assertEqual(row['fulfillment_status'],'delivered')
            self.assertEqual(row['shipments'][0]['status'],'delivered')
            self.assertEqual(len(row['shipments'][0]['events']),3)
            self.assertTrue(row['shipments'][0]['simulated'])
    def test_idempotency_state_and_isolation(self):
        order,_=self.setup_order();command={'operation_key':'c'*64,'order_id':order,'expected_order_revision':1,'test_execution_confirmed':True}
        path='/api/test-store/v1/actions/fulfillment.create'
        a=self.remote_api.post(path,command,format='json');self.assertEqual(a.status_code,200,a.data)
        b=self.remote_api.post(path,command,format='json');self.assertEqual(a.data,b.data)
        self.assertEqual(self.remote_api.post(path,{**command,'operation_key':'d'*64},format='json').status_code,409)
        self.assertEqual(self.remote_api.post(path,{**command,'expected_order_revision':2},format='json').status_code,409)
        self.assertEqual(self.remote_api.post('/api/test-store/v1/actions/order.detail',{'order_id':str(uuid.uuid4())},format='json').status_code,404)
        self.assertEqual(self.lab('test.shipment.advance',{'shipment_id':a.data['external_id'],'expected_revision':1,'status':'delivered','test_data_confirmed':True}).status_code,422)
        self.assertEqual(self.remote_api.post('/api/test-store/v1/actions/fulfillment.record',{'shipment_id':a.data['external_id'],'expected_shipment_revision':1,'operation_key':'e'*64},format='json').status_code,409)
    def test_all_operational_contracts_in_bound_package_and_mapping(self):
        pkg=package_contract();actions={a['action'] for a in mapping_actions()}
        self.assertEqual(pkg['version'],'1.5.0')
        self.assertTrue({'order.detail','fulfillment.create','fulfillment.lookup','shipment.read','fulfillment.record',
            'shipments.read','support.message-feed','support.context','support.reply','materials.save','test.shipment.advance'}<=actions)
        from contracts.mapping import MappingAnswer
        for action in actions:
            MappingAnswer.model_validate({'summary':'test','questions':[],'limitations':[],
                'mappings':[{'action':action,'direction':'response','fixed_path':'','external_path':'','meaning':'unknown','conversion':'','evidence':'','status':'question','fixed_path':'result'}]})

    def test_unknown_create_recovers_by_lookup_not_repeated_write(self):
        _,release=self.setup_order()
        from apps.integrations.test_store import UnknownResult
        calls=[]
        def lose_receipt(method,url,**kwargs):
            response=self.request(method,url,**kwargs)
            if url.endswith('/fulfillment.create'):
                calls.append(url);raise UnknownResult('lost response after test write')
            return response
        with patch('apps.integrations.test_store.httpx.request',side_effect=lose_receipt):
            run=self.start(release)
            for _ in range(3):self.step(run)
            self.confirm(run);self.step(run)
            self.assertEqual(run.status,'needs_attention')
            self.assertEqual(ExchangeRecord.objects.filter(kind='shipment').count(),1)
            result=self.api.post(f'/api/v1/runs/{run.id}/resume',{'expected_revision':run.revision},format='json')
            self.assertEqual(result.status_code,200,result.data)
            run.refresh_from_db();self.step(run)
            self.assertEqual(run.cursor,4);self.assertEqual(len(calls),1)

@override_settings(LOCAL=True,DESKTOP_MODE=True)
class FulfillmentHTTPTests(BusinessMixin,LiveServerTestCase):
    api_call=StoreTestingTests.api_call
    lab=StoreTestingTests.lab
    publish=StoreTestingTests.publish
    setup_order=FulfillmentTests.setup_order
    advance=FulfillmentTests.advance
    test_eight_steps_wait_for_dispatch_and_delivery_sync_logistics=FulfillmentTests.test_eight_steps_wait_for_dispatch_and_delivery_sync_logistics
    def setUp(self):
        StoreTestingTests.setUp(self)
        settings=self.settings(TEST_STORE_API_BASE=self.live_server_url+'/api/test-store/v1')
        settings.enable();self.addCleanup(settings.disable)
    def request(self,method,url,**kwargs):
        return real_http_request(method,url,**kwargs)
