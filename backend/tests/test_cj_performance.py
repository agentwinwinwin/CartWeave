from unittest.mock import patch
import httpx
from django.test import SimpleTestCase
from apps.connections import cj


class CJTransportTests(SimpleTestCase):
    def test_pool_reused_without_sharing_credentials_or_cookies(self):
        requests=[]
        def respond(request):
            requests.append(request)
            return httpx.Response(200,headers={'set-cookie':'session=private; Path=/'},json={})
        with httpx.Client(transport=httpx.MockTransport(respond),event_hooks={'request':[cj._without_cookies]}) as client:
            with patch.object(cj._transport,'client',client,create=True):
                cj.pooled_request('GET',cj.BASE+'/product/query',headers={'CJ-Access-Token':'account-a'})
                cj.pooled_request('GET',cj.BASE+'/product/query',headers={'CJ-Access-Token':'account-b'})
            self.assertNotIn('CJ-Access-Token',client.headers)
            self.assertEqual(len(client.cookies),0)
        self.assertEqual([r.headers['CJ-Access-Token'] for r in requests],['account-a','account-b'])
        self.assertTrue(all('cookie' not in r.headers for r in requests))
