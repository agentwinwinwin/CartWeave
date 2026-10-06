from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.connections.models import SupplierConnection
from apps.connections.services import encrypt
from apps.connections.cj import CJUnavailable

DIRECTORY = [{'categoryFirstName': 'Pets', 'categoryFirstList': [{'categorySecondName': 'Travel', 'categorySecondList': [{'categoryId': 'cj-leaf', 'categoryName': 'Carriers'}]}]}]
EMPTY = {'content': [{'productList': []}]}
PRODUCTS = {'content': [{'productList': [{'id': 'product-1', 'nameEn': 'Carrier', 'sellPrice': '12.00'}]}]}


class CJCatalogTests(TestCase):
    @patch('apps.connections.cj_catalog.read_cj')
    def test_single_keyword_has_no_hidden_category_or_fallback(self,read):
        for keyword in ('cat','hat'):
            with self.subTest(keyword=keyword):
                read.reset_mock();read.return_value=EMPTY
                self.query.update(keyword=keyword,categoryId='',categoryQueries=[],candidateSource='catalog',emptyResultPolicy='pause')
                response=self.search()
                self.assertEqual(response.status_code,200,response.data)
                self.assertEqual(read.call_count,1)
                self.assertEqual(read.call_args.kwargs['params'],{'page':1,'size':20,'keyWord':keyword})

    @patch('apps.connections.cj_catalog.read_cj')
    def test_trending_retry_retains_source_and_category(self, read):
        self.query.update(candidateSource='trending', categoryId='cj-leaf', emptyResultPolicy='drop_keyword_once')
        seen = []
        def respond(connection, path, **kwargs):
            if path == '/product/getCategory': return DIRECTORY
            seen.append(dict(kwargs['params']))
            return EMPTY
        read.side_effect = respond
        response = self.search()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['outcome'], 'no_results')
        self.assertEqual(len(seen), 2)
        for params in seen:
            self.assertEqual(params['productFlag'], 0)
            self.assertEqual(params['orderBy'], 0)
            self.assertEqual(params['sort'], 'desc')
            self.assertEqual(params['categoryId'], 'cj-leaf')
            self.assertNotIn('countryCode', params)
        self.assertNotIn('keyWord', seen[1])
        self.assertEqual(response.data['query']['candidateSource'], 'trending')

    @patch('apps.connections.cj_catalog.read_cj', return_value=EMPTY)
    def test_trending_zero_does_not_fallback_to_catalog(self, read):
        self.query['candidateSource'] = 'trending'
        self.assertEqual(self.search().data['outcome'], 'no_results')
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.kwargs['params']['productFlag'], 0)
        self.query['candidateSource'] = 'sales_rank'
        self.assertEqual(self.search().status_code, 400)

    @patch('apps.connections.cj_catalog.cj_request',return_value={})
    def test_read_slot_is_faster_but_still_serialized(self, request):
        from apps.connections.cj_catalog import read_cj
        from apps.common.errors import Conflict
        before=timezone.now()
        read_cj(self.connection,'/product/query')
        self.connection.refresh_from_db()
        seconds=(self.connection.verification_until-before).total_seconds()
        self.assertGreaterEqual(seconds,1.1)
        self.assertLess(seconds,1.3)
        with self.assertRaises(Conflict):read_cj(self.connection,'/product/query')
        self.assertEqual(request.call_count,1)

    @patch('apps.connections.cj_catalog.read_cj',return_value=PRODUCTS)
    def test_verified_search_filter_does_not_guess_sales_country(self, read):
        from apps.connections.cj_catalog import preview,ProductSearch
        preview(self.member,ProductSearch(**self.query),stock_only=True)
        self.assertEqual(read.call_args.kwargs['params']['verifiedWarehouse'],1)
        self.assertNotIn('countryCode',read.call_args.kwargs['params'])
        self.assertNotIn('startWarehouseInventory',read.call_args.kwargs['params'])
    def setUp(self):
        self.user = User.objects.create_user('catalog-user')
        self.team = Team.objects.create(name='Catalog')
        self.member = Membership.objects.create(team=self.team, user=self.user, role='operator')
        self.connection = SupplierConnection.objects.create(team=self.team, credential_ciphertext=encrypt('test-key'), token_ciphertext=encrypt('test-token'), token_expires_at=timezone.now()+timedelta(days=1), status='verified')
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.query = {'market': 'US', 'requestedCurrency': 'EUR', 'limit': 30, 'categoryId': '', 'keyword': 'carrier', 'emptyResultPolicy': 'pause'}

    def search(self):
        return self.api.post('/api/v1/connections/cj/search-preview', self.query, format='json')

    @patch('apps.connections.cj_catalog.read_cj')
    def test_real_directory_ids_cache_and_refresh(self, read):
        read.return_value = DIRECTORY
        response = self.api.get('/api/v1/connections/cj/categories')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['categories'], [{'id': 'cj-leaf', 'name': 'Carriers', 'path': 'Pets / Travel / Carriers'}])
        self.api.get('/api/v1/connections/cj/categories')
        self.assertEqual(read.call_count, 1)
        self.api.get('/api/v1/connections/cj/categories?refresh=1')
        self.assertEqual(read.call_count, 2)

    @patch('apps.connections.cj_catalog.read_cj')
    def test_invalid_category_stops_before_search(self, read):
        read.return_value = DIRECTORY
        self.query['categoryId'] = 'home'
        self.assertEqual(self.search().status_code, 422)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.args[1], '/product/getCategory')

    @patch('apps.connections.cj_catalog.read_cj')
    def test_zero_results_pause_without_retry_or_country_mapping(self, read):
        read.return_value = EMPTY
        response = self.search()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['outcome'], 'no_results')
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.kwargs['params'], {'page': 1, 'size': 20, 'keyWord': 'carrier'})

    @patch('apps.connections.cj_catalog.read_cj')
    def test_explicit_keyword_fallback_preserves_category(self, read):
        self.query.update(categoryId='cj-leaf', emptyResultPolicy='drop_keyword_once')
        seen = []
        def respond(connection, path, **kwargs):
            if path == '/product/getCategory': return DIRECTORY
            seen.append(dict(kwargs['params']))
            return EMPTY if len(seen) == 1 else PRODUCTS
        read.side_effect = respond
        response = self.search()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['outcome'], 'results')
        self.assertEqual(len(response.json()['attempts']), 2)
        self.assertEqual(seen, [{'page': 1, 'size': 20, 'categoryId': 'cj-leaf', 'keyWord': 'carrier'}, {'page': 1, 'size': 20, 'categoryId': 'cj-leaf'}])

    @patch('apps.connections.cj_catalog.read_cj')
    def test_upstream_failure_is_not_zero_results(self, read):
        read.side_effect = CJUnavailable('CJ 请求失败')
        response = self.search()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('outcome', response.json())

    def test_validation_permission_and_expired_token(self):
        self.query.update(keyword='', emptyResultPolicy='drop_keyword_once')
        self.assertEqual(self.search().status_code, 422)
        self.query['countryCode'] = 'US'
        self.assertEqual(self.search().status_code, 400)
        del self.query['countryCode']
        self.query.update(keyword='carrier', emptyResultPolicy='pause')
        SupplierConnection.objects.update(token_expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(self.api.get('/api/v1/connections/cj/categories').status_code, 409)
        self.member.role = 'viewer'
        self.member.save()
        self.assertEqual(self.search().status_code, 403)

    def multi_query(self):
        self.query.update(keyword='', limit=7, categoryQueries=[
            {'categoryId': 'hats', 'keyword': 'summer'},
            {'categoryId': 'clothes', 'keyword': 'cotton'},
        ])

    @patch('apps.connections.cj_catalog.catalog')
    @patch('apps.connections.cj_catalog.read_cj')
    def test_multi_category_union_deduplication_and_total_quota(self, read, directory):
        self.multi_query()
        directory.return_value = {'categories': [{'id': 'hats'}, {'id': 'clothes'}]}
        read.return_value = PRODUCTS
        response = self.search()
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual([g['quota'] for g in data['groups']], [4, 3])
        self.assertEqual(len(data['products']), 1)
        self.assertEqual([call.kwargs['params'] for call in read.call_args_list], [
            {'page': 1, 'size': 4, 'categoryId': 'hats', 'keyWord': 'summer'},
            {'page': 1, 'size': 3, 'categoryId': 'clothes', 'keyWord': 'cotton'},
        ])

    @patch('apps.connections.cj_catalog.catalog')
    @patch('apps.connections.cj_catalog.read_cj')
    def test_multi_zero_and_failure_are_distinct(self, read, directory):
        self.multi_query()
        directory.return_value = {'categories': [{'id': 'hats'}, {'id': 'clothes'}]}
        read.side_effect = [PRODUCTS, EMPTY]
        data = self.search().json()
        self.assertEqual(data['outcome'], 'results')
        self.assertEqual(data['groups'][1]['outcome'], 'no_results')
        read.side_effect = [PRODUCTS, CJUnavailable('failure')]
        data = self.search().json()
        self.assertEqual(data['outcome'], 'partial')
        self.assertEqual(data['groups'][1]['outcome'], 'error')

    def test_multi_rejects_duplicates_mixed_scope_and_insufficient_budget(self):
        self.multi_query()
        self.query['categoryQueries'][1]['categoryId'] = 'hats'
        self.assertEqual(self.search().status_code, 400)
        self.multi_query()
        self.query['limit'] = 1
        self.assertEqual(self.search().status_code, 400)
        self.multi_query()
        self.query['keyword'] = 'global'
        self.assertEqual(self.search().status_code, 400)
        self.multi_query()
        self.query['categoryQueries'][0]['categoryId'] = ''
        self.assertEqual(self.search().status_code, 400)

    @patch('apps.connections.cj_catalog.catalog')
    @patch('apps.connections.cj_catalog.read_cj')
    def test_multi_fallback_only_retries_empty_category(self, read, directory):
        self.multi_query()
        self.query['emptyResultPolicy'] = 'drop_keyword_once'
        directory.return_value = {'categories': [{'id': 'hats'}, {'id': 'clothes'}]}
        read.side_effect = [EMPTY, PRODUCTS, PRODUCTS]
        data = self.search().json()
        self.assertEqual([len(g['attempts']) for g in data['groups']], [2, 1])
        self.assertEqual(read.call_args_list[1].kwargs['params']['categoryId'], 'hats')
        self.assertNotIn('keyWord', read.call_args_list[1].kwargs['params'])
