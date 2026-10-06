import hashlib
import json
from unittest.mock import patch
from datetime import timedelta
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
import httpx
from apps.identity.models import Team,Membership
from apps.connections.models import Store
from apps.connections.services import encrypt
from apps.teststore.models import ApiClient as StoreClient,BusinessEvent
from apps.commerce.models import BusinessRecord,SyncState
from apps.finance.models import OrderFinancialFact
from contracts.store_api import ACTION_CONTRACTS


class BusinessSyncTests(TestCase):
    def setUp(self):
        self.user=User.objects.create_user('business-owner')
        self.team=Team.objects.create(name='Business fixtures')
        self.member=Membership.objects.create(team=self.team,user=self.user,role='admin')
        self.store=Store.objects.create(team=self.team,name='Fixture store',verified=True,
            credential_ciphertext=encrypt('fixture-token'),capabilities=list(ACTION_CONTRACTS))
        self.client=StoreClient.objects.create(name='Fixture source',storefront_id=self.store.id,
            token_hash=hashlib.sha256(b'fixture-token').hexdigest())
        self.api=APIClient();self.api.force_authenticate(self.user)
        self.remote_api=APIClient();self.remote_api.credentials(HTTP_AUTHORIZATION='Bearer fixture-token')
        self.now=timezone.now().isoformat()
        self.order={'external_id':'order-1','revision':1,'observed_at':self.now,'source_ref':'Synthetic test source, temporary DB only',
            'ordered_at':self.now,'customer_id':'customer-1','customer_name':'Fixture customer','currency':'USD','total':'110.00',
            'payment_status':'paid','fulfillment_status':'unfulfilled','tracking_number':None,'item_summary':'Hat × 1'}
        self.customer={'external_id':'customer-1','revision':1,'observed_at':self.now,'source_ref':'Fixture CRM',
            'name':'Fixture customer','email':None,'country':'US','status':'active'}
        self.finance={'external_order_id':'order-1','source_event_id':'payment-1','source_ref':'Fixture actual ledger, temporary DB only',
            'revision':1,'paid_at':self.now,'observed_at':self.now,'currency':'USD','paid_total':'110.00','tax_collected':'10.00',
            'refund_total':'0.00','tax_refunded':'0.00','procurement':'20.00','shipping':'10.00','platform_payment':'3.00','advertising':None,'other':'0.00'}

    def event(self,kind,payload):
        return BusinessEvent.objects.create(client=self.client,kind=kind,
            external_id=payload.get('external_id',payload.get('external_order_id')),revision=payload['revision'],payload=payload)

    def request(self,method,url,**kwargs):
        self.assertEqual(method,'POST');self.assertEqual(kwargs['headers']['Authorization'],'Bearer fixture-token')
        action=url.rsplit('/',1)[-1]
        response=self.remote_api.post('/api/test-store/v1/actions/'+action,kwargs['json'],format='json')
        return httpx.Response(response.status_code,json=response.data)

    def sync(self,kind):
        with patch('apps.integrations.test_store.httpx.request',side_effect=self.request):
            return self.api.post(f'/api/v1/stores/{self.store.id}/sync/{kind}',{},format='json')

    def test_real_contract_dispatch_sync_projection_and_no_duplicate_revenue(self):
        for kind,payload in [('orders',self.order),('customers',self.customer),('finance',self.finance)]:
            self.event(kind,payload)
            first=self.sync(kind);self.assertEqual(first.status_code,200,first.data)
            self.assertEqual(first.data['received'],1)
            again=self.sync(kind);self.assertEqual(again.status_code,200,again.data);self.assertEqual(again.data['received'],0)
        self.assertEqual(BusinessRecord.objects.count(),2);self.assertEqual(OrderFinancialFact.objects.count(),1)
        self.assertEqual(self.api.get('/api/v1/business/orders').data['results'][0]['payment_status'],'paid')
        self.assertIsNone(self.api.get('/api/v1/business/customers').data['results'][0]['email'])
        report=self.api.get('/api/v1/earnings?timezone=UTC').data
        self.assertEqual(report['summary']['net_sales'],'100.00')
        self.assertEqual(report['summary']['profit_before_ads'],'67.00')
        self.assertIsNone(report['summary']['operating_profit'])

    def test_pages_resume_persistent_cursor_and_updates_customer(self):
        for i in range(51):self.event('customers',{**self.customer,'external_id':f'c-{i}'})
        first=self.sync('customers');self.assertEqual(first.data['received'],50);self.assertTrue(first.data['has_more'])
        second=self.sync('customers');self.assertEqual(second.data['received'],1);self.assertFalse(second.data['has_more'])
        self.assertEqual(self.api.get('/api/v1/business/customers').data['count'],51)
        self.event('customers',{**self.customer,'external_id':'c-0','revision':2,'name':'Updated'})
        self.assertEqual(self.sync('customers').status_code,200)
        self.assertEqual(BusinessRecord.objects.get(external_id='c-0').payload['name'],'Updated')
        self.assertEqual(BusinessRecord.objects.count(),51)

    def test_malformed_page_and_financial_gap_do_not_advance_or_partially_save(self):
        self.event('orders',self.order)
        self.event('orders',{**self.order,'external_id':'bad','payment_status':'invented'})
        self.assertEqual(self.sync('orders').status_code,422)
        self.assertEqual(BusinessRecord.objects.count(),0)
        self.assertEqual(SyncState.objects.get(kind='orders').cursor,'0')
        self.event('finance',self.finance)
        self.event('finance',{**self.finance,'external_order_id':'gap','source_event_id':'gap','revision':2})
        self.assertEqual(self.sync('finance').status_code,409)
        self.assertEqual(OrderFinancialFact.objects.count(),0)
        self.assertEqual(SyncState.objects.get(kind='finance').cursor,'0')

    def test_capability_version_lease_and_tenant_isolation(self):
        self.store.capabilities=['listing.validate','listing.publish','listing.wait'];self.store.save()
        self.assertEqual(self.sync('orders').status_code,422)
        self.store.capabilities=list(ACTION_CONTRACTS);self.store.save()
        state=SyncState.objects.create(team=self.team,store=self.store,kind='orders',store_version=1,
            lease_until=timezone.now()+timedelta(seconds=20))
        self.assertEqual(self.sync('orders').status_code,409)
        state.lease_until=None;state.store_version=2;state.save()
        self.assertEqual(self.sync('orders').status_code,409)
        user=User.objects.create_user('other-business');team=Team.objects.create(name='Other')
        Membership.objects.create(team=team,user=user,role='admin');self.api.force_authenticate(user)
        self.assertEqual(self.sync('orders').status_code,404)
        self.assertEqual(self.api.get('/api/v1/business/orders').data['count'],0)

    def test_bad_cursor_and_empty_export_are_not_fake_orders(self):
        self.assertEqual(self.remote_api.post('/api/test-store/v1/actions/orders.read',{'cursor':'99999999999999999999'},format='json').status_code,400)
        self.assertEqual(self.sync('orders').data['received'],0)
        self.assertEqual(self.api.get('/api/v1/business/orders').data['count'],0)
        self.assertIsNone(self.api.get('/api/v1/earnings').data['summary']['operating_profit'])
