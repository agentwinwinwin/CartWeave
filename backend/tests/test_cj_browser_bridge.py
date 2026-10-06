import json
import tempfile
import threading
import time
from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.connections import cj_browser_bridge as bridge, cj_intelligence as source
from apps.common.errors import RuleError
from .test_cj_intelligence import raw_fixture


@override_settings(LOCAL=True, DESKTOP_MODE=True)
class ChromeBridgeTests(TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        setting=override_settings(CJ_INTELLIGENCE_DIR=self.temp.name);setting.enable();self.addCleanup(setting.disable)
        self.user=User.objects.create_user('chrome-reader');self.team=Team.objects.create(name='Chrome reader')
        Membership.objects.create(user=self.user,team=self.team,role='admin')
        self.ui=APIClient();self.ui.force_authenticate(self.user)
        self.extension=APIClient()
        self.headers={'HTTP_ORIGIN':'chrome-extension://'+'a'*32,'HTTP_HOST':'127.0.0.1:8010','REMOTE_ADDR':'127.0.0.1'}

    def post(self, action, payload, headers=None):
        return self.extension.post('/api/v1/cj-browser/'+action,payload,format='json',**(headers or self.headers))

    def pair(self):
        response=self.ui.post('/api/v1/connections/cj/intelligence/chrome-pairing',{},format='json')
        self.assertEqual(response.status_code,200)
        code=response.data['code']
        response=self.post('pair',{'code':code});self.assertEqual(response.status_code,200,response.data)
        token=response.data['token'];self.headers['HTTP_AUTHORIZATION']='Bearer '+token
        self.assertNotIn(token,(source.folder(self.team.id)/'extension.enc').read_text())
        self.assertEqual(self.post('pair',{'code':code}).status_code,422)
        return token

    def test_pairing_is_single_use_scoped_and_does_not_export_login(self):
        token=self.pair()
        status=self.ui.get('/api/v1/connections/cj/intelligence')
        self.assertTrue(status.data['extension']['paired']);self.assertTrue(status.data['extension']['online'])
        self.assertNotIn(token,json.dumps(status.data));self.assertFalse((source.folder(self.team.id)/'session.enc').exists())
        self.assertEqual(self.ui.post('/api/v1/connections/cj/intelligence/login',{},format='json').status_code,422)
        bad={**self.headers,'HTTP_ORIGIN':'chrome-extension://'+'b'*32}
        self.assertEqual(self.post('poll',{},bad).status_code,422)
        # Scoped token must not authorize normal business APIs.
        self.assertIn(self.extension.get('/api/v1/products',**self.headers).status_code,(401,403))
        self.assertEqual(self.ui.delete('/api/v1/connections/cj/intelligence/chrome-pairing').status_code,200)
        self.assertEqual(self.post('poll',{}).status_code,422)

    def test_no_unpaired_remote_or_web_origin_can_claim_jobs(self):
        self.assertEqual(self.post('poll',{}).status_code,422)
        self.pair()
        for key,value in [('HTTP_ORIGIN','https://www.cjdropshipping.com'),('REMOTE_ADDR','192.0.2.1'),('HTTP_HOST','other.example:8010')]:
            self.assertIn(self.post('poll',{}, {**self.headers,key:value}).status_code,(400,422))
        self.assertEqual(self.post('poll',{'url':'https://example.com'}).status_code,422)

    def prepare_job(self):
        data=bridge.load(self.team.id,'extension.enc')
        job={'id':'test-job','status':'pending','token_digest':data['digest'],'expires_at':time.time()+60}
        bridge.save(self.team.id,'extension-job.json',job)
        response=self.post('poll',{});self.assertEqual(response.status_code,200)
        self.assertEqual(set(response.data['job']['pages']),{'sales','advertising'})
        self.assertIsNone(self.post('poll',{}).data['job'])
        return job

    def test_results_fail_closed_and_never_import_cookie_or_partial_data(self):
        self.pair();job=self.prepare_job()
        self.assertEqual(self.post('complete',{'id':job['id'],'error':{}}).status_code,422)
        pages={kind:raw_fixture(kind) for kind in source.PATHS};pages['sales']['cookies']=[{'value':'secret'}]
        response=self.post('complete',{'id':job['id'],'pages':pages})
        self.assertEqual(response.data['status'],'failed');self.assertIsNone(source.status(self.team.id)['snapshot'])
        self.assertNotIn('secret', (source.folder(self.team.id)/'extension-job.json').read_text())
        self.assertEqual(self.post('complete',{'id':job['id'],'pages':pages}).status_code,422)
        self.prepare_job()
        response=self.post('complete',{'id':job['id'],'error':'challenge'})
        self.assertEqual(response.data['status'],'failed')
        self.assertIn('安全验证',bridge.load(self.team.id,'extension-job.json')['error'])

    def test_fresh_two_page_result_reaches_the_existing_collector(self):
        self.pair();out={}
        def run():
            try:out['result']=source.collect(self.team.id)
            except Exception as e:out['error']=e
        thread=threading.Thread(target=run);thread.start()
        self.addCleanup(lambda:thread.join(timeout=2))
        deadline=time.monotonic()+3
        while not bridge.load(self.team.id,'extension-job.json') and time.monotonic()<deadline:time.sleep(.02)
        job=self.post('poll',{}).data['job'];self.assertIsNotNone(job)
        response=self.post('complete',{'id':job['id'],'pages':{kind:raw_fixture(kind) for kind in source.PATHS}})
        self.assertEqual(response.data['status'],'done',response.data)
        thread.join(timeout=3);self.assertFalse(thread.is_alive());self.assertNotIn('error',out)
        self.assertEqual(out['result']['collector'],'chrome_extension')
        self.assertEqual(len(out['result']['sales']['rows']),10)
        self.assertEqual(source.status(self.team.id)['snapshot'],out['result'])
        self.assertFalse(source.lock_for(self.team.id).locked())

    def test_offline_and_expired_job_do_not_reuse_history(self):
        with self.assertRaises(RuleError):source.collect(self.team.id)
        self.pair();self.prepare_job()
        job=bridge.load(self.team.id,'extension-job.json');job['expires_at']=time.time()-1
        bridge.save(self.team.id,'extension-job.json',job)
        self.assertEqual(self.post('complete',{'id':job['id'],'error':'page'}).status_code,422)
        data=bridge.load(self.team.id,'extension.enc');data['last_seen']=time.time()-100
        bridge.save(self.team.id,'extension.enc',data)
        with self.assertRaises(RuleError):source.collect(self.team.id)
