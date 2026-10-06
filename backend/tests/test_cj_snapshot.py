from datetime import timedelta
from django.test import SimpleTestCase
from django.utils import timezone
from apps.common.errors import RuleError
from apps.runtime.cj_snapshot import extract, fresh, complete_detail


class CJDetailSnapshotTests(SimpleTestCase):
    def raw(self):
        return {'id':'p','nameen':'Hat','bigimg':'https://oss-cf.cjdropshipping.com/hat.jpg',
            'accountName':'not retained','stanProducts':[{'id':'v','pid':'p','sku':'sku','variantkey':'Black','sellprice':'5'}],
            'variantInventory':[{'vid':'v','inventory':[{'countryCode':'CN','cjInventory':0,'factoryInventory':100,'verifiedWarehouse':2}]}]}

    def test_zero_stock_and_source_are_not_changed_or_replaced_by_factory(self):
        snapshot=extract(self.raw(),'p',timezone.now().isoformat())
        variant=snapshot['variants'][0]
        self.assertTrue(complete_detail(variant))
        self.assertEqual(variant['_cj_detail']['inventories'][0]['cjInventory'],0)
        self.assertEqual(variant['_cj_detail']['inventories'][0]['verifiedWarehouse'],2)
        self.assertNotIn('accountName',snapshot)

    def test_absent_inventory_needs_supplement_but_explicit_empty_does_not(self):
        raw=self.raw();raw.pop('variantInventory')
        self.assertFalse(complete_detail(extract(raw,'p',timezone.now().isoformat())['variants'][0]))
        raw['variantInventory']=[{'vid':'v','inventory':[]}]
        self.assertTrue(complete_detail(extract(raw,'p',timezone.now().isoformat())['variants'][0]))

    def test_expired_snapshot_is_not_refreshed(self):
        snapshot=extract(self.raw(),'p',(timezone.now()-timedelta(hours=2)).isoformat())
        with self.assertRaises(RuleError):fresh(snapshot)

    def test_wrong_product_or_duplicate_variant_is_rejected(self):
        with self.assertRaises(RuleError):extract(self.raw(),'wrong',timezone.now().isoformat())
        raw=self.raw();raw['stanProducts']*=2
        with self.assertRaises(RuleError):extract(raw,'p',timezone.now().isoformat())
