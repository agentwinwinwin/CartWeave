from django.test import TestCase
from django.contrib.auth.models import User
from apps.identity.models import Team, Membership
from tests import test_publication as publication


class ProductSyncTests(TestCase):
    setUp = publication.PublicationTests.setUp
    start = publication.PublicationTests.start
    drain = publication.PublicationTests.drain
    approve = publication.PublicationTests.approve

    def test_publication_progress_is_projected_without_copying_or_creating_products(self):
        run=self.start()
        self.assertEqual(self.api.get('/api/v1/products').data['results'][0]['status'],'draft')
        self.drain()
        self.assertEqual(self.api.get('/api/v1/products').data['results'][0]['status'],'review')
        self.approve(run);self.drain();self.approve(run);self.drain()
        result=self.api.get('/api/v1/products').data
        self.assertEqual(result['results'][0]['status'],'published')
        self.assertEqual(result['stats']['published'],1)
        self.assertEqual(result['results'][0]['source_kind'],'test_fixture')
        self.assertIsNotNone(result['results'][0]['confirmed_at'])
        self.assertNotIn('cj_vid',str(result))
        self.assertNotIn('credential',str(result))
        self.assertEqual(self.api.get('/api/v1/products?q=does-not-exist').data['count'],0)
        self.assertEqual(self.api.get('/api/v1/products?status=review').data['count'],0)
        self.assertEqual(self.api.get('/api/v1/products?channel=amazon').data['count'],0)
        from apps.teststore.models import PublishedProduct
        self.assertEqual(PublishedProduct.objects.count(),1)

    def test_team_isolation_and_pagination_validation(self):
        self.start()
        for value in ['0','-1','abc']:
            self.assertEqual(self.api.get('/api/v1/products?page='+value).status_code,400)
        self.assertEqual(self.api.get('/api/v1/products?status=fake').status_code,400)
        other=User.objects.create_user('other-product-team')
        team=Team.objects.create(name='other-products')
        Membership.objects.create(user=other,team=team,role='viewer')
        self.api.force_authenticate(user=other)
        self.assertEqual(self.api.get('/api/v1/products').data['count'],0)
        self.api.force_authenticate(user=None)
        self.assertIn(self.api.get('/api/v1/products').status_code,[401,403])
