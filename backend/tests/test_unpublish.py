from unittest.mock import patch
from django.test import TestCase
from tests import test_publication as publication
from apps.listings.models import ExternalOperation, ChannelListing
from apps.teststore.models import PublishedProduct
from apps.audit.models import AuditRecord
from apps.integrations.test_store import UnknownResult


class UnpublishTests(TestCase):
    setUp = publication.PublicationTests.setUp
    start = publication.PublicationTests.start
    drain = publication.PublicationTests.drain
    approve = publication.PublicationTests.approve

    def ready(self):
        run=self.start();self.drain();self.approve(run);self.drain();self.approve(run);self.drain()
        self.store.capabilities+=['listing.unpublish','listing.status'];self.store.save(update_fields=['capabilities'])
        self.publication=ChannelListing.objects.get(run=run)
        self.command={'expected_digest':self.publication.evidence['digest'],'store_version':self.store.configuration_version,'reason':'测试夹具下架，非真实商品'}
        self.url=f'/api/v1/products/{run.id}/unpublish'
        return run

    def test_actual_adapter_unpublish_updates_catalog_and_projection_idempotently(self):
        self.ready()
        for _ in range(2):
            result=self.api.post(self.url,self.command,format='json');self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(PublishedProduct.objects.get().status,'inactive')
        self.assertEqual(self.api.get('/api/v1/products').data['results'][0]['status'],'inactive')
        self.assertEqual(self.api.get('/api/test-store/v1/catalog').data['products'],[])
        self.assertEqual(ExternalOperation.objects.filter(payload__action='listing.unpublish').count(),1)
        self.assertEqual(AuditRecord.objects.filter(action='listing.unpublish.confirmed').count(),1)
        self.assertEqual(AuditRecord.objects.filter(action='listing.unpublish.succeeded').count(),1)

    def test_missing_capability_stale_digest_or_permission_never_writes(self):
        self.ready()
        for change in [{'expected_digest':'a'*64},{'store_version':999},{'reason':'   '}]:
            response=self.api.post(self.url,{**self.command,**change},format='json')
            self.assertIn(response.status_code,[400,409,422])
        self.store.capabilities=['listing.validate','listing.publish','listing.wait'];self.store.save(update_fields=['capabilities'])
        self.assertEqual(self.api.post(self.url,self.command,format='json').status_code,422)
        self.member.role='operator';self.member.save()
        self.assertEqual(self.api.post(self.url,self.command,format='json').status_code,403)
        self.assertEqual(PublishedProduct.objects.get().status,'active')

    def test_timeout_after_remote_commit_queries_before_retry(self):
        self.ready()
        original=publication.TestAdapter.unpublish
        def timeout(adapter, command):
            original(adapter,command)
            raise UnknownResult()
        with patch.object(publication.TestAdapter,'unpublish',timeout):
            self.assertEqual(self.api.post(self.url,self.command,format='json').status_code,202)
        self.assertEqual(self.api.get('/api/v1/products').data['results'][0]['status'],'unpublish_pending')
        self.assertEqual(self.api.get('/api/v1/products?view=active').data['count'],1)
        self.assertEqual(self.api.get('/api/v1/products?view=archived').data['count'],0)
        with patch.object(publication.TestAdapter,'unpublish',side_effect=AssertionError('Must query existing inactive state, not send again')):
            response=self.api.post(self.url,self.command,format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(self.api.get('/api/v1/products').data['results'][0]['status'],'inactive')

    def test_mismatched_channel_receipt_cannot_claim_success(self):
        self.ready()
        original=publication.TestAdapter.unpublish
        def incorrect(adapter,command):
            receipt=original(adapter,command)
            receipt['digest']='b'*64
            return receipt
        with patch.object(publication.TestAdapter,'unpublish',incorrect):
            response=self.api.post(self.url,self.command,format='json')
        self.assertEqual(response.status_code,422)
        self.assertEqual(self.api.get('/api/v1/products').data['results'][0]['status'],'unpublish_pending')
        self.assertFalse(AuditRecord.objects.filter(action='listing.unpublish.succeeded').exists())
        # The remote write may already have happened: reconcile, don't issue a new write.
        with patch.object(publication.TestAdapter,'unpublish',side_effect=AssertionError('No second write')):
            response=self.api.post(self.url,self.command,format='json')
        self.assertEqual(response.status_code,200,response.data)

    def test_archive_separates_confirmed_unpublishing_without_deleting_records(self):
        self.ready()
        self.assertEqual(self.api.get('/api/v1/products?view=active').data['count'],1)
        self.assertEqual(self.api.get('/api/v1/products?view=archived').data['count'],0)
        self.api.post(self.url,self.command,format='json')
        self.assertEqual(self.api.get('/api/v1/products?view=active').data['count'],0)
        archive=self.api.get('/api/v1/products?view=archived').data
        self.assertEqual(archive['count'],1)
        self.assertEqual(archive['results'][0]['status'],'inactive')
        self.assertEqual(archive['stats']['inactive'],1)
        self.assertEqual(PublishedProduct.objects.count(),1)
        self.assertEqual(ChannelListing.objects.count(),1)
        self.assertEqual(self.api.get('/api/v1/products?view=unknown').status_code,400)
        self.assertEqual(self.api.get('/api/v1/products?view=active&status=inactive').status_code,400)
