from decimal import Decimal
from django.db import transaction
from django.db.models import Exists, OuterRef
from apps.common.errors import Conflict
from apps.common.utils import parse, digest
from apps.identity.permissions import require_role
from apps.audit.models import AuditRecord
from contracts.finance import FinancialFact
from .models import OrderFinancialFact

COSTS = ('procurement', 'shipping', 'platform_payment', 'advertising', 'other')


def record_fact(team, store, actor, payload):
    """Internal ingestion seam, not a public write API or an implemented connector."""
    require_role(actor, team, ['approver'])
    if store.team_id != team.id:
        raise Conflict('账目店铺不属于当前团队。')
    validated = FinancialFact.model_validate(parse(FinancialFact, payload))
    values = validated.model_dump()
    with transaction.atomic():
        # Serialize updates for this store; immutable revisions preserve old facts.
        type(store).objects.select_for_update().get(pk=store.pk)
        original = OrderFinancialFact.objects.filter(store=store, source_event_id=values['source_event_id']).first()
        if original:
            actual = {k:getattr(original, k) for k in values}
            if actual != values:
                raise Conflict('同一来源事件不能覆盖不同账目。')
            return original
        last = OrderFinancialFact.objects.filter(store=store, external_order_id=values['external_order_id']).order_by('-revision').first()
        if values['revision'] != (last.revision+1 if last else 1):
            raise Conflict('账目版本不连续。')
        if last and values['observed_at'] < last.observed_at:
            raise Conflict('不能用较旧资料覆盖最新账目。')
        if last and (last.paid_at != values['paid_at'] or last.currency != values['currency']):
            raise Conflict('付款日期或币种改变需要人工核对，不能重归属账目。')
        fact = OrderFinancialFact.objects.create(team=team, store=store, **values)
        AuditRecord.objects.create(team=team, actor=actor, action='finance.fact.recorded', object_id=str(fact.id), metadata={'store':str(store.id), 'revision':fact.revision, 'digest':digest(validated.model_dump(mode='json'))})
        return fact


def current_facts(team):
    newer = OrderFinancialFact.objects.filter(team=team, store_id=OuterRef('store_id'), external_order_id=OuterRef('external_order_id'), revision__gt=OuterRef('revision'))
    return OrderFinancialFact.objects.filter(team=team).annotate(superseded=Exists(newer)).filter(superseded=False)


def calculate(fact):
    revenue = fact.paid_total-fact.tax_collected-fact.refund_total+fact.tax_refunded
    missing = [k for k in COSTS if getattr(fact,k) is None]
    before_ads = revenue-sum((getattr(fact,k) for k in COSTS if k!='advertising'), Decimal(0)) if not any(k!='advertising' for k in missing) else None
    profit = before_ads-fact.advertising if not missing else None
    return {'net_sales':revenue, 'refunds':fact.refund_total-fact.tax_refunded, 'profit_before_ads':before_ads, 'operating_profit':profit, 'missing_costs':missing}


def totals(rows):
    pending = sum(r['operating_profit'] is None for r in rows)
    return {'orders':len(rows), 'pending_cost_orders':pending, 'complete_orders':len(rows)-pending,
        'net_sales':sum((r['net_sales'] for r in rows),Decimal(0)) if rows else None,
        'refunds':sum((r['refunds'] for r in rows),Decimal(0)) if rows else None,
        'operating_profit':sum((r['operating_profit'] for r in rows),Decimal(0)) if rows and not pending else None,
        'profit_before_ads':sum((r['profit_before_ads'] for r in rows),Decimal(0)) if rows and all(r['profit_before_ads'] is not None for r in rows) else None}
