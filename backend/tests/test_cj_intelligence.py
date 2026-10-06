import copy
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.common.errors import RuleError, Conflict
from apps.connections import cj_intelligence as service


def raw_fixture(kind):
    root=Path(__file__).resolve().parents[2]
    source=json.loads((root/'scripts/fixtures/cj-intelligence.json').read_text())[kind]
    rows=[]
    for rank,name,category,*metrics in source['rows']:
        cells=([str(rank),name,*metrics,'View Analysis'] if kind=='advertising' else
               [f'{rank}\n{name}',f'{metrics[0]} / {metrics[1]}',metrics[2],'View Analysis'])
        rows.append({'cells':cells,'url':service.ORIGIN+service.PATHS[kind]+'/'+category})
    return {'url':source['sourceUrl'],'rows':rows,
        'headers':['Rank','Category Name','TikTok Ad Count','Facebook Ad Count','Action'] if kind=='advertising' else
                  ['Rank / Categories','Sales\n/\nSales Volume','Ranking Change Rate','Action'],
        'context':'Data Updated:\nOct. 01, 2026\nPlatform\nAll\nRegion\nAll' if kind=='advertising' else
                  'Amazon platform product sales data\nData Updated:\nSep. 08, 2026\nSite\nAll Sites'}


@override_settings(LOCAL=True,DESKTOP_MODE=True)
class IntelligenceTests(TestCase):
    def setUp(self):
        self.user=User.objects.create_user('web-collector')
        self.team=Team.objects.create(name='Web collector')
        self.member=Membership.objects.create(user=self.user,team=self.team,role='admin')
        self.client=APIClient();self.client.force_authenticate(self.user)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        setting=override_settings(CJ_INTELLIGENCE_DIR=self.temp.name);setting.enable();self.addCleanup(setting.disable)

    def test_both_observed_rankings_parse_without_fabricated_exact_counts(self):
        for kind in service.PATHS:
            result=service.parse_page(kind,raw_fixture(kind))
            self.assertEqual(len(result['rows']),10)
            self.assertEqual(result['precision'],'rounded_web_display')
            self.assertIsNone(result['period'])
        sales=service.parse_page('sales',raw_fixture('sales'))
        self.assertEqual(sales['data_source'],'amazon_market')
        self.assertEqual(sales['updated_on'],'2026-09-08')
        self.assertEqual(sales['rows'][0]['metrics']['sales_display'],'$415.7M')

    def test_invalid_or_partial_pages_are_not_accepted(self):
        for change in ('missing','rank','host','date','scope','headers','duplicate'):
            raw=copy.deepcopy(raw_fixture('sales'))
            if change=='missing':raw['rows'].pop()
            if change=='rank':raw['rows'][0]['cells'][0]='2\nWrong'
            if change=='host':raw['rows'][0]['url']='https://evil.example/123'
            if change=='date':raw['context']=raw['context'].replace('Sep. 08, 2026','unknown')
            if change=='scope':raw['context']=raw['context'].replace('All Sites','US')
            if change=='headers':raw['headers'][0]='Changed'
            if change=='duplicate':raw['rows'][1]['url']=raw['rows'][0]['url']
            with self.subTest(change=change),self.assertRaises(RuleError):service.parse_page('sales',raw)

    def test_chinese_screenshot_headers_and_metadata_preserve_the_same_facts(self):
        raw=raw_fixture('sales')
        raw['headers']=['排名 / 类目','销售额 / 销量','排名增长率','操作']
        raw['context']='销售仪表板\n数据来源：Amazon 平台商品销售数据\n数据更新: Sep. 08, 2026\n站点\nAll Sites'
        raw['rows'][0]['cells'][0]=raw['rows'][0]['cells'][0].replace('\n',' ')
        actual=service.parse_page('sales',raw)
        self.assertEqual(actual,service.parse_page('sales',raw_fixture('sales')))
        raw['context']=raw['context'].replace('All Sites','US')
        with self.assertRaises(RuleError):service.parse_page('sales',raw)

    def test_chinese_ad_header_aliases_do_not_relax_scope_or_rank_checks(self):
        raw=raw_fixture('advertising')
        raw['headers']=['排名','类目名称','TikTok 广告数','Facebook 广告数','操作']
        raw['context']='数据更新: Oct. 01, 2026\n平台\nAll\n地区\nAll'
        self.assertEqual(service.parse_page('advertising',raw),service.parse_page('advertising',raw_fixture('advertising')))
        raw['rows'].pop()
        with self.assertRaises(RuleError):service.parse_page('advertising',raw)

    @patch('apps.connections.cj_intelligence.collect')
    def test_plain_http_collection_does_not_call_a_model(self,collect):
        collect.return_value={'sales':service.parse_page('sales',raw_fixture('sales')),
                              'advertising':service.parse_page('advertising',raw_fixture('advertising'))}
        response=self.client.post('/api/v1/connections/cj/intelligence/collect',{},format='json')
        self.assertEqual(response.status_code,200)
        collect.assert_called_once_with(self.team.id)
        self.assertEqual(len(response.data['advertising']['rows']),10)
        response=self.client.post('/api/v1/connections/cj/intelligence/collect',{'url':'http://localhost'},format='json')
        self.assertEqual(response.status_code,422)
        self.assertEqual(collect.call_count,1)

    def test_unconfigured_and_unauthenticated_fail_explicitly(self):
        response=self.client.post('/api/v1/connections/cj/intelligence/collect',{},format='json')
        self.assertEqual(response.status_code,422)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get('/api/v1/connections/cj/intelligence').status_code,(401,403))

    def test_concurrent_collection_is_still_blocked(self):
        root=service.folder(self.team.id)
        service.write_private(root/'session.enc',service.encrypt(json.dumps({'cookies':[],'origins':[]})))
        lock=service.lock_for(self.team.id)
        lock.acquire()
        try:
            with self.assertRaises(Conflict):
                service.collect(self.team.id)
        finally:
            lock.release()

    def test_browser_lock_is_shared_by_independent_local_instances(self):
        first=service.LocalBrowserLock(self.team.id)
        second=service.LocalBrowserLock(self.team.id)
        self.assertTrue(first.acquire())
        try:
            self.assertFalse(second.acquire())
        finally:
            first.release()
        self.assertTrue(second.acquire())
        second.release()

    @override_settings(DESKTOP_MODE=False)
    def test_team_deployment_does_not_open_local_browser(self):
        self.assertEqual(self.client.get('/api/v1/connections/cj/intelligence').status_code,422)
