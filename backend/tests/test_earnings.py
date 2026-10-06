from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework.exceptions import ValidationError
from apps.identity.models import Team, Membership
from apps.connections.models import Store
from apps.common.errors import Conflict
from apps.finance.services import record_fact, calculate
from apps.finance.models import OrderFinancialFact


class EarningsTests(TestCase):
    def setUp(self):
        self.user=User.objects.create_user('earnings-test')
        self.team=Team.objects.create(name='Finance fixture')
        self.member=Membership.objects.create(user=self.user,team=self.team,role='admin')
        self.store=Store.objects.create(team=self.team,name='Finance test store')
        self.api=APIClient();self.api.force_authenticate(self.user)
        self.payload={'external_order_id':'order-1','source_event_id':'event-1','source_ref':'Fixture actual-payment record, not a live order','revision':1,'paid_at':'2026-10-03T16:30:00Z','observed_at':'2026-10-04T02:00:00Z','currency':'USD','paid_total':'110.00','tax_collected':'10.00','refund_total':'22.00','tax_refunded':'2.00','procurement':'20.00','shipping':'10.00','platform_payment':'3.00','advertising':'5.00','other':'0.00'}
        self.url='/api/v1/earnings?start=2026-10-04&end=2026-10-04&timezone=Asia/Shanghai'

    def record(self,**changes):
        return record_fact(self.team,self.store,self.user,{**self.payload,**changes})

    def test_unconnected_is_not_zero_profit_and_does_not_import_demo_or_publications(self):
        response=self.api.get(self.url)
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['status'],'awaiting_connection')
        self.assertIsNone(response.data['summary']['net_sales'])
        self.assertIsNone(response.data['summary']['operating_profit'])
        self.assertEqual(response.data['results'],[])
        self.assertEqual(OrderFinancialFact.objects.count(),0)
        self.assertEqual(response['Cache-Control'],'no-store')

    def test_actual_cost_calculation_tax_refund_and_negative_profit(self):
        self.record()
        result=self.api.get(self.url).data
        self.assertEqual(result['summary']['net_sales'],'80.00')
        self.assertEqual(result['summary']['refunds'],'20.00')
        self.assertEqual(result['summary']['profit_before_ads'],'47.00')
        self.assertEqual(result['summary']['operating_profit'],'42.00')
        self.record(revision=2,source_event_id='event-2',refund_total='110.00',tax_refunded='10.00')
        self.assertEqual(self.api.get(self.url).data['summary']['operating_profit'],'-38.00')

    def test_missing_cost_is_not_zero_and_advertising_has_separate_basis(self):
        self.record(advertising=None)
        result=self.api.get(self.url).data
        self.assertIsNone(result['summary']['operating_profit'])
        self.assertEqual(result['summary']['profit_before_ads'],'47.00')
        self.assertEqual(result['results'][0]['missing_costs'],['advertising'])
        self.record(revision=2,source_event_id='event-2',advertising=None,shipping=None)
        self.assertIsNone(self.api.get(self.url).data['summary']['profit_before_ads'])

    def test_idempotent_immutable_revisions_recompute_original_day_not_today(self):
        first=self.record()
        self.assertEqual(self.record().pk,first.pk)
        self.assertEqual(OrderFinancialFact.objects.count(),1)
        with self.assertRaises(Conflict):self.record(paid_total='111')
        with self.assertRaises(Conflict):self.record(revision=3,source_event_id='gap')
        with self.assertRaises(Conflict):self.record(revision=2,source_event_id='wrong-day',paid_at='2026-10-04T16:30:00Z',observed_at='2026-10-05T00:00:00Z')
        self.record(revision=2,source_event_id='later',observed_at='2026-10-10T00:00:00Z',shipping='20')
        with self.assertRaises(Conflict):self.record(revision=3,source_event_id='stale',observed_at='2026-10-09T00:00:00Z')
        result=self.api.get(self.url).data
        self.assertEqual(result['count'],1)
        self.assertEqual(result['summary']['operating_profit'],'32.00')
        self.assertEqual(result['results'][0]['revision'],2)
        self.assertEqual(OrderFinancialFact.objects.count(),2)
        with self.assertRaises(ValueError):first.save()
        with self.assertRaises(ValueError):first.delete()

    def test_timezone_currency_store_filters_and_no_cross_currency_sum(self):
        self.record()
        self.record(external_order_id='euro',source_event_id='euro',currency='EUR')
        result=self.api.get(self.url).data
        self.assertEqual(result['count'],1)
        self.assertEqual(result['summary']['operating_profit'],'42.00')
        utc=self.api.get('/api/v1/earnings?start=2026-10-03&end=2026-10-03&timezone=UTC').data
        self.assertEqual(utc['count'],1)
        self.assertEqual(self.api.get(self.url+'&currency=EUR').data['count'],1)
        no_orders=self.api.get(self.url.replace('2026-10-04','2026-10-05')).data
        self.assertEqual(no_orders['status'],'no_data')
        self.assertIsNone(no_orders['summary']['operating_profit'])

    def test_partial_day_does_not_claim_full_profit(self):
        self.record()
        self.record(external_order_id='unknown',source_event_id='unknown',procurement=None)
        result=self.api.get(self.url).data
        self.assertEqual(result['summary']['complete_orders'],1)
        self.assertEqual(result['summary']['pending_cost_orders'],1)
        self.assertIsNone(result['summary']['operating_profit'])

    def test_input_validation_and_tenant_isolation(self):
        for values in [{'paid_at':'2026-10-03T16:30:00'},{'procurement':'-1'},{'shipping':'1.123'},{'tax_refunded':'99'},{'currency':'JPY'}]:
            with self.assertRaises(ValidationError):self.record(**values)
        self.record()
        other=User.objects.create_user('other-finance')
        team=Team.objects.create(name='Other finance')
        Membership.objects.create(user=other,team=team,role='viewer')
        self.api.force_authenticate(other)
        self.assertEqual(self.api.get(self.url).data['count'],0)
        self.assertEqual(self.api.get(self.url+'&store='+str(self.store.id)).status_code,400)
        self.api.force_authenticate(None)
        self.assertIn(self.api.get(self.url).status_code,(401,403))

    def test_filters_and_read_only_http_boundary(self):
        for query in ['start=bad','timezone=Invalid/Zone','currency=JPY','page=0','store=bad','start=2026-01-01&end=2026-10-04']:
            self.assertEqual(self.api.get('/api/v1/earnings?'+query).status_code,400)
        self.assertEqual(self.api.post('/api/v1/earnings',self.payload,format='json').status_code,405)
