"""Bounded durable CJ selection. All external calls are read-only, including freight trials."""
import re
import time
import uuid
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_UP
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.html import strip_tags
from apps.common.errors import RuleError, Conflict
from apps.common.utils import parse, digest
from apps.connections.cj_catalog import connection_for, read_cj, preview, ProductSearch, candidate_search_params
from apps.identity.models import Membership
from apps.identity.permissions import require_role
from contracts.assets import allowed_image
from contracts.listings import Brief
from contracts.selection import SelectionQuery
from .models import SelectionTask


def amount(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = Decimal(str(value))
        return result if result.is_finite() and result >= 0 else None
    except (InvalidOperation, ValueError):
        return None


def read(task, path, **kwargs):
    member = Membership.objects.get(team=task.team, user=task.requested_by, active=True)
    connection = connection_for(member)
    if connection.configuration_version != task.connection_version:
        raise Conflict('CJ 连接版本变化，请创建新选品任务。')
    delay = (connection.verification_until - timezone.now()).total_seconds() if connection.verification_until else 0
    if delay > 3:
        raise Conflict('CJ 连接正在验证，请稍后重新创建任务。')
    if delay > 0:
        time.sleep(delay + .05)
    return read_cj(connection, path, **kwargs)


def collect_page(task, search, saved=None):
    """One durable search page per worker turn; preview remains capped at twenty."""
    if task.query.get('demand_first_collection'):
        if task.query.get('strategy') not in ('product.opportunity.v4','product.opportunity.v5'):raise RuleError('需求前置采集策略不兼容。')
        from .demand_collection import collect
        return collect(task, search, saved)
    member = Membership.objects.get(team=task.team, user=task.requested_by, active=True)
    stock_only = not task.query.get('allow_factory_supply',False)
    if search.limit <= 20:
        return preview(member, search, stock_only=stock_only), False
    groups = search.categoryQueries or [search]
    state = deepcopy(saved) if saved else {'group_index': 0, 'page': 1, 'group_products': [], 'products': [], 'groups': [], 'attempts': []}
    index = state['group_index']
    group = groups[index]
    quota = search.limit // len(groups) + (index < search.limit % len(groups))
    page_size = min(quota, 20)
    query = ProductSearch(categoryId=group.categoryId, keyword=group.keyword,
        candidateSource=search.candidateSource,
        market=search.market, requestedCurrency=search.requestedCurrency, limit=page_size,
        emptyResultPolicy=search.emptyResultPolicy if group.keyword else 'pause')
    if state['page'] == 1:
        # Reuse directory validation and the explicit one-time keyword retry.
        result = preview(member, query, stock_only=stock_only)
        if result['outcome'] not in ('results', 'no_results'):
            raise RuleError('CJ 采集查询失败，不会将失败当作零结果。')
        products = result['products']
        state['active_keyword'] = result['attempts'][-1]['keyword'] if result['attempts'] else group.keyword
        state['attempts'].extend(result['attempts'])
    else:
        from apps.connections.cj import samples
        params = {'page': state['page'], 'size': page_size, **candidate_search_params(search)}
        if stock_only: params['verifiedWarehouse'] = 1
        if group.categoryId: params['categoryId'] = group.categoryId
        if state['active_keyword']: params['keyWord'] = state['active_keyword']
        products = samples(read(task, '/product/listV2', params=params), limit=page_size)
    seen = {row['id'] for row in state['group_products']}
    for row in products:
        if row['id'] not in seen and len(state['group_products']) < quota:
            state['group_products'].append(row)
            seen.add(row['id'])
    # Bound page reads even if CJ repeats pages; unused/duplicate quota is not reassigned.
    if len(products) == page_size and state['page'] < (quota + page_size - 1) // page_size and len(state['group_products']) < quota:
        state['page'] += 1
        return state, True
    state['groups'].append({'categoryId': group.categoryId, 'keyword': group.keyword, 'quota': quota,
        'outcome': 'results' if state['group_products'] else 'no_results', 'products': state['group_products']})
    merged = {row['id'] for row in state['products']}
    state['products'].extend(row for row in state['group_products'] if row['id'] not in merged)
    state.update(group_index=index + 1, page=1, group_products=[])
    if state['group_index'] < len(groups):
        return state, True
    return {'outcome': 'results' if state['products'] else 'no_results', 'products': state['products'],
        'groups': state['groups'], 'attempts': state['attempts'], 'query': search.model_dump(), 'preview_only': False}, False


def advance(task):
    q = SelectionQuery(**task.query)
    evidence = deepcopy(task.evidence)
    rows = deepcopy(task.candidates)
    if task.stage == 'collect':
        member = Membership.objects.get(team=task.team, user=task.requested_by, active=True)
        connection = connection_for(member)
        if connection.configuration_version != task.connection_version:
            raise Conflict('CJ 连接已改变。')
        search = ProductSearch(**{k: v for k, v in task.query.items() if k in ProductSearch.model_fields})
        result, collecting = collect_page(task, search, evidence.get('collection'))
        if collecting:
            return 'collect', {'collection': result}, rows, 'queued', '分页采集中；每批最多二十款，不扩大查询范围。'
        if result['outcome'] != 'results':
            raise RuleError('CJ 搜索无完整结果；请检查类目、关键词或接口错误，不会自动扩大范围。')
        evidence = {'records': result['products'], 'index': 0, 'variant_index': 0,
                    'search': {'attempts': result['attempts'], 'groups': result.get('groups', [])},
                    'observed_at': timezone.now().isoformat()}
        return 'details', evidence, rows, 'queued', '采集完成：仅处理任务上限内商品，不代表全目录。'
    if task.stage == 'details':
        index = evidence['index']
        if index >= len(evidence['records']):
            return 'rank', evidence, rows, 'queued', '商品与规格证据采集结束。'
        pid = str(evidence['records'][index]['id'])
        product = read(task, '/product/query', params={'pid': pid})
        if str(product.get('pid')) != pid:
            raise RuleError('CJ 详情商品标识不匹配。')
        variants = product.get('variants')
        if not isinstance(variants, list) or not variants:
            rows.append({'pid': pid, 'status': 'rejected', 'reason': '商品缺少规格列表'})
            evidence['index'] += 1
            return 'details', evidence, rows, 'queued', '缺少规格的商品已排除。'
        evidence['product'] = {'pid': pid, 'title': strip_tags(str(product.get('productNameEn') or ''))[:200],
            'image': product.get('productImage'), 'variants': variants[:q.variants_per_product],
            'omitted_variants': max(0, len(variants) - q.variants_per_product)}
        evidence['variant_index'] = 0
        return 'inventory', evidence, rows, 'queued', f'详情已读取；本商品未研究规格数：{evidence["product"]["omitted_variants"]}。'
    if task.stage == 'inventory':
        product = evidence['product']
        if evidence['variant_index'] >= len(product['variants']):
            evidence['index'] += 1
            return 'details', evidence, rows, 'queued', '进入下一个商品。'
        variant = product['variants'][evidence['variant_index']]
        vid = variant.get('vid')
        if not isinstance(vid, str) or not vid:
            raise RuleError('CJ 规格缺少 vid。')
        detail = read(task, '/product/variant/queryByVid', params={'vid': vid, 'features': 'enable_inventory'})
        if str(detail.get('vid')) != vid or str(detail.get('pid')) != product['pid']:
            raise RuleError('CJ 商品与规格对应关系不匹配。')
        inventory = detail.get('inventories') or []
        warehouses = [w for w in inventory if isinstance(w, dict) and str(w.get('verifiedWarehouse')) == '1'
                      and isinstance(w.get('cjInventory'), int) and not isinstance(w.get('cjInventory'), bool)
                      and w['cjInventory'] >= q.minimum_inventory and re.fullmatch('[A-Z]{2}', str(w.get('countryCode', '')))]
        factories = [w for w in inventory if isinstance(w, dict)
                     and isinstance(w.get('factoryInventory'), int) and not isinstance(w.get('factoryInventory'), bool)
                     and w['factoryInventory'] >= q.minimum_inventory
                     and re.fullmatch('[A-Z]{2}', str(w.get('countryCode', '')))] if q.allow_factory_supply else []
        cost = amount(detail.get('variantSellPrice'))
        image = detail.get('variantImage') or variant.get('variantImage') or product['image']
        row = {'pid': product['pid'], 'vid': vid, 'title': product['title'], 'sku': detail.get('variantSku'),
               'option': str(detail.get('variantKey') or vid)[:40], 'image': image,
               'supplier_cost': str(cost) if cost is not None else None, 'currency': 'USD',
               'observed_at': timezone.now().isoformat(), 'status': 'pending',
               'omitted_variants': product['omitted_variants'], 'sales': None}
        row['inventory_evidence'] = [{k: w.get(k) for k in ('countryCode', 'totalInventory', 'cjInventory', 'factoryInventory', 'verifiedWarehouse')} for w in inventory if isinstance(w, dict)]
        missing = []
        if not warehouses and not factories: missing.append('无符合策略的 CJ 仓现货或已允许的工厂供货数量')
        if cost is None or cost <= 0: missing.append('供货价格缺失或无效')
        if not allowed_image(image): missing.append('原图不在受信 HTTPS 来源范围')
        if not row['title'] or not row['sku']: missing.append('标题或 SKU 缺失')
        if missing:
            row.update(status='rejected', reason='；'.join(missing))
            rows.append(row)
            evidence['variant_index'] += 1
            return 'inventory', evidence, rows, 'queued', '资料不完整的规格已排除，不用零值代替。'
        # Explicit deterministic origin strategy: prefer destination country, then largest verified inventory.
        if warehouses:
            warehouse = sorted(warehouses, key=lambda w: (w['countryCode'] != q.market, -w['cjInventory']))[0]
            row.update(origin=warehouse['countryCode'], inventory=warehouse['cjInventory'], supply_type='cj_stock', processing_days=0)
        else:
            warehouse = sorted(factories, key=lambda w: (w['countryCode'] != q.market, -w['factoryInventory']))[0]
            row.update(origin=warehouse['countryCode'], supply_type='factory', factory_reported_quantity=warehouse['factoryInventory'],
                       inventory=min(q.factory_sale_limit, warehouse['factoryInventory']) if q.factory_sale_limit else 0,
                       processing_days=q.factory_processing_days,
                       supply_warning='工厂报量非已核实现货；备货天数与限售量为运营假设，发布前必须人工确认供货。')
        evidence['candidate'] = row
        return 'freight', evidence, rows, 'queued', '已记录规格供货来源，准备查询真实线路报价。'
    if task.stage == 'freight':
        row = evidence['candidate']
        quotes = read(task, '/logistic/freightCalculate', method='POST', allow_list=True,
                      json={'startCountryCode': row['origin'], 'endCountryCode': q.market,
                            'products': [{'quantity': 1, 'vid': row['vid']}]})
        eligible = []
        for quote in quotes if isinstance(quotes, list) else []:
            if not isinstance(quote, dict):
                continue
            price = amount(quote.get('logisticPrice'))
            aging = re.fullmatch(r'(\d+)(?:\s*-\s*(\d+))?', str(quote.get('logisticAging', '')))
            if price is not None and aging and int(aging[2] or aging[1]) + (row.get('processing_days') or 0) <= q.maximum_days and quote.get('logisticName'):
                eligible.append((price, quote, int(aging[2] or aging[1])))
        if not eligible:
            row.update(status='rejected', reason='没有符合备货加运输时效要求且价格明确的线路')
        else:
            def quoted_total(item):
                base, quote, _ = item
                known_fees = (amount(quote.get('taxesFee')) or Decimal(0)) + (amount(quote.get('clearanceOperationFee')) or Decimal(0))
                return max(base + max(q.tax_reserve_usd or Decimal(0), known_fees), amount(quote.get('totalPostageFee')) or Decimal(0))
            price, quote, days = min(eligible, key=quoted_total)
            row.update(shipping_cost=str(price), maximum_days=days, logistic=quote['logisticName'],
                       quoted_taxes=str(quote['taxesFee']) if amount(quote.get('taxesFee')) is not None else None,
                       clearance_fee=str(quote['clearanceOperationFee']) if amount(quote.get('clearanceOperationFee')) is not None else None,
                       quoted_total_postage=str(quote['totalPostageFee']) if amount(quote.get('totalPostageFee')) is not None else None,
                       quote_observed_at=timezone.now().isoformat())
            if row.get('supply_type') == 'factory' and (q.factory_processing_days is None or q.factory_sale_limit is None):
                row.update(status='needs_review', reason='工厂供货已进入研究；请明确备货天数与限售量后重建任务，不将工厂报量当可售现货')
            elif q.tax_reserve_usd is None:
                row.update(status='needs_review', reason='缺少明确税费/清关及附加费预留；不可按零核算')
            else:
                supplied_tax = amount(quote.get('taxesFee')) or Decimal(0)
                clearance = amount(quote.get('clearanceOperationFee')) or Decimal(0)
                # User reserve is explicitly an assumption, not evidence of a zero tax rate.
                tax = max(q.tax_reserve_usd, supplied_tax + clearance)
                landed = Decimal(row['supplier_cost']) + quoted_total((price, quote, days))
                retail = (landed / (1 - (q.fee_percent + q.margin_percent)/100)).quantize(Decimal('.01'), rounding=ROUND_UP)
                contribution = (retail * (1-q.fee_percent/100)-landed).quantize(Decimal('.01'))
                row.update(status='eligible', landed_cost=str(landed), suggested_price=str(retail),
                           contribution_before_ads=str(contribution), tax_reserve=str(tax),
                           reason='供货与配送可行性规则通过；价格按目标贡献率倒推，不证明市场需求或净利润')
                if row.get('supply_type') == 'factory':
                    row['reason'] = '工厂供货方案可提交人工审核；报量未核实，备货和限售量为运营假设，不自动批准'
                    row['estimated_total_days'] = days + q.factory_processing_days
        rows.append(row)
        evidence.pop('candidate', None)
        evidence['variant_index'] += 1
        return 'inventory', evidence, rows, 'queued', '运费与成本核算已记录。'
    if task.stage == 'rank':
        eligible = sorted([r for r in rows if r['status'] == 'eligible'], key=lambda r: (Decimal(r['landed_cost']), r['maximum_days'], r['vid']))
        evidence['ranked_vids'] = [r['vid'] for r in eligible]
        return 'done', evidence, rows, 'ready' if eligible else 'needs_attention', '规则策略按到货成本与时效排序；不冒充 AI 热销预测。'
    raise RuleError('未知选品阶段。')


def due_selection_tasks():
    return SelectionTask.objects.filter(Q(status='queued') | Q(status='running', lease_until__lt=timezone.now())).order_by('created_at').values_list('id', flat=True)[:1]


def process_selection(pk):
    with transaction.atomic():
        task = SelectionTask.objects.select_for_update().get(pk=pk)
        if task.status not in ('queued', 'running') or (task.status == 'running' and task.lease_until and task.lease_until > timezone.now()):
            return
        token = uuid.uuid4()
        task.status, task.lease_token, task.lease_until = 'running', token, timezone.now() + timedelta(minutes=3)
        task.save()
    try:
        require_role(task.requested_by, task.team, ['operator'])
        stage, evidence, rows, status, message = advance(task)
        error = ''
    except Exception as exc:
        from apps.common.db_retry import transient_database_lock
        if transient_database_lock(exc):
            raise
        from rest_framework.exceptions import APIException
        stage, evidence, rows, status = task.stage, task.evidence, task.candidates, 'needs_attention'
        error = str(exc.detail)[:500] if isinstance(exc, APIException) else '选品阶段数据异常，已停止；请检查数据结构后新建任务。'
        message = error
    with transaction.atomic():
        current = SelectionTask.objects.select_for_update().get(pk=pk)
        if current.lease_token != token or current.status != 'running':
            return
        current.stage, current.evidence, current.candidates, current.status, current.error = stage, evidence, rows, status, error
        current.log = [*current.log, {'stage': task.stage, 'message': message, 'at': timezone.now().isoformat()}]
        current.lease_until = None
        if status in ('ready', 'needs_attention'):
            current.completed_at = timezone.now()
        current.save()


def selected_brief(task, vid):
    if task.status != 'ready' or not task.completed_at or task.completed_at < timezone.now()-timedelta(hours=1):
        raise RuleError('选品任务未就绪或报价超过一小时，请重新选品。')
    member = Membership.objects.get(team=task.team, user=task.requested_by, active=True)
    if connection_for(member).configuration_version != task.connection_version:
        raise RuleError('CJ 连接已变化，旧选品证据不可发布。')
    row = next((r for r in task.candidates if r.get('vid') == vid and r['status'] == 'eligible'), None)
    if not row:
        raise RuleError('规格未通过选品检查。')
    from django.utils.dateparse import parse_datetime
    quoted_at=parse_datetime(row.get('quote_observed_at',''))
    if not quoted_at or quoted_at<timezone.now()-timedelta(hours=1):
        raise RuleError('原始运费报价已超过一小时或缺少时间证据，请重新选品；任务完成时间不能延长报价。')
    market_note=''
    if task.query.get('strategy') in ('product.opportunity.v4','product.opportunity.v5'):
        from .cj_evidence import verify_fresh
        proposal=task.evidence.get('selection_proposal') or {}
        verify_fresh(proposal.get('evidence',[]),'order_count')
        if not proposal.get('evidence'):raise RuleError('CJ 订单证据缺失，不能发布。')
        market_note='MARKET_EVIDENCE：CJ 商品订单数，统计周期与国家未声明，非近90天销量或卖出件数；必须两轮人工核验。'
    if task.query.get('strategy')=='product.opportunity.v3':
        from .cj_evidence import verify_fresh
        proposal=task.evidence.get('selection_proposal') or {}
        verify_fresh(proposal.get('evidence',[]))
        if not proposal.get('evidence'):raise RuleError('CJ 销量证据缺失，不能发布。')
        market_note='MARKET_EVIDENCE：CJ 平台近 90 天销量，未按目标国家拆分；无增长、搜索或广告成本证据，必须两轮人工核验。'
    if task.query.get('strategy')=='product.opportunity.v2':
        from apps.skills.market_evidence import evidence_for
        proposal=task.evidence.get('selection_proposal') or {}
        evidence,_=evidence_for(task.team,proposal.get('evidence_ref'),task.query['market'],task.query['requestedCurrency'])
        if proposal.get('evidence_digest')!=evidence.digest:raise RuleError('市场证据摘要不匹配。')
        market_note='MARKET_EVIDENCE：市场数据人工导入未独立核实；含广告成本为假设，必须两轮人工核验。'
    return parse(Brief, {'product_id': 'cj-'+digest({'pid': row['pid'], 'vid': vid})[:24],
        'title': row['title'], 'description': row['title'], 'selling_points': [row['option']],
        'images': [row['image']], 'currency': 'USD', 'market': task.query['market'],
        'variants': [{'sku': row['sku'], 'size': row['option'], 'cj_pid': row['pid'], 'cj_vid': vid,
                      'price': row['suggested_price'], 'inventory': row['inventory']}],
        'source_kind': 'cj_selection', 'evidence_ref': f'cj-selection:{task.id}:{vid}',
        'source_note': (f'FACTORY_SUPPLY：工厂报量 {row["factory_reported_quantity"]} 未核实；运营设定限售 {row["inventory"]}、备货 {row["processing_days"]} 天；须人工核验供货。' if row.get('supply_type') == 'factory' else '') + market_note + 'CJ API 供货与运费记录；税费/费用率/目标贡献率为运营假设，非销量预测。'})


def verify_selection_brief(team, brief):
    if brief.get('source_kind') != 'cj_selection':
        return
    try:
        _, task_id, vid = brief['evidence_ref'].split(':', 2)
        task = SelectionTask.objects.get(pk=task_id, team=team)
        expected = selected_product_brief(task,vid) if brief['evidence_ref'].startswith('cj-batch:') else selected_brief(task, vid)
    except (ValueError, SelectionTask.DoesNotExist):
        raise RuleError('选品证据无效或不属于当前工作区。')
    if digest(expected) != digest(brief):
        raise RuleError('选品商品资料被改写，请重新研究；不可伪造 CJ 证据。')


def selected_product_brief(task,pid):
    rows=[r for r in task.candidates if r.get('pid')==pid and r.get('status')=='eligible']
    if not rows or not task.query.get('batch_target'):raise RuleError('批次商品未完成规格核验。')
    briefs=[selected_brief(task,r['vid']) for r in sorted(rows,key=lambda r:r['vid'])]
    first=next((b for b in briefs if b['source_note'].startswith('FACTORY_SUPPLY：')),briefs[0])
    return parse(Brief,{**first,'product_id':'cj-'+digest({'pid':pid})[:24],
        'evidence_ref':f'cj-batch:{task.id}:{pid}',
        'variants':[v for b in briefs for v in b['variants']]})
