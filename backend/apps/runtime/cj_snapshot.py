"""Small canonical snapshot of one CJ full-detail response, not raw account data."""
from copy import deepcopy
from datetime import timedelta
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from apps.common.errors import RuleError


def extract(raw, pid, observed_at):
    if str(raw.get('id')) != pid:
        raise RuleError('CJ 完整详情商品标识不匹配。')
    variants = raw.get('stanProducts')
    if not isinstance(variants, list):
        return None  # Old/incomplete CJ replies use the explicit supplement path.
    inventories = raw.get('variantInventory')
    stock = {}
    for row in inventories if isinstance(inventories, list) else []:
        if isinstance(row, dict) and isinstance(row.get('vid'), str) and isinstance(row.get('inventory'), list):
            if row['vid'] in stock:raise RuleError('CJ 完整详情重复规格库存。')
            stock[row['vid']] = [{k:w.get(k) for k in ('countryCode','cjInventory','factoryInventory','verifiedWarehouse')}
                for w in row['inventory'] if isinstance(w, dict)]
    normalized=[]
    seen=set()
    for row in variants:
        if not isinstance(row,dict) or not isinstance(row.get('id'),str) or str(row.get('pid'))!=pid:
            raise RuleError('CJ 完整详情规格标识不匹配。')
        if row['id'] in seen:raise RuleError('CJ 完整详情重复规格标识。')
        seen.add(row['id'])
        detail={'pid':pid,'vid':row['id'],'variantSku':row.get('sku'),'variantKey':row.get('variantkey'),
            'variantImage':row.get('img'),'variantSellPrice':row.get('sellprice')}
        # Empty inventory is an explicit fact; absent inventory requires a supplement.
        if row['id'] in stock:detail['inventories']=stock[row['id']]
        normalized.append({'vid':row['id'],'variantImage':row.get('img'),'_cj_detail':detail})
    return {'pid':pid,'productNameEn':raw.get('nameen'),'productImage':raw.get('bigimg'),
        'variants':normalized,'observed_at':observed_at,'source':'/product/productDetail/query'}


def fresh(snapshot):
    observed=parse_datetime(snapshot.get('observed_at',''))
    if not observed or timezone.is_naive(observed) or observed>timezone.now() or observed<timezone.now()-timedelta(hours=1):
        raise RuleError('CJ 完整商品资料已过期，请重新采集，不刷新原证据时间。')
    return deepcopy(snapshot)


def complete_detail(variant):
    detail=variant.get('_cj_detail')
    return isinstance(detail,dict) and all(key in detail and detail[key] is not None
        for key in ('pid','vid','variantSku','variantKey','variantSellPrice','inventories')) and isinstance(detail['inventories'],list)
