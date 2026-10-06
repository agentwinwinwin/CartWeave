"""Extend the closed registry without changing the immutable formatter artifact."""
import hashlib
from pathlib import Path
from uuid import UUID
from apps.common.errors import RuleError
from . import handlers, opportunity, opportunity_market, market_evidence,opportunity_cj,opportunity_orders,opportunity_listings
from .models import SkillVersion

def handler_hash(key):
    if key==opportunity_listings.HANDLER:
        return hashlib.sha256(Path(opportunity_listings.__file__).read_bytes()+Path(opportunity_orders.__file__).read_bytes()+Path(opportunity.__file__).read_bytes()).hexdigest()
    if key==opportunity_orders.HANDLER:
        return hashlib.sha256(Path(opportunity_orders.__file__).read_bytes()+Path(opportunity.__file__).read_bytes()).hexdigest()
    if key==opportunity_cj.HANDLER:
        return hashlib.sha256(Path(opportunity_cj.__file__).read_bytes()+Path(opportunity.__file__).read_bytes()).hexdigest()
    if key==opportunity_market.HANDLER:
        return hashlib.sha256(Path(opportunity_market.__file__).read_bytes()+Path(opportunity.__file__).read_bytes()+Path(market_evidence.__file__).read_bytes()).hexdigest()
    if key==opportunity.HANDLER:
        return hashlib.sha256(Path(opportunity.__file__).read_bytes()).hexdigest()
    return handlers.handler_hash(key)

def check_skill(skill):
    if skill.handler not in (opportunity.HANDLER,opportunity_market.HANDLER,opportunity_cj.HANDLER,opportunity_orders.HANDLER,opportunity_listings.HANDLER):
        return handlers.check_skill(skill)
    skill.refresh_from_db()
    versions={opportunity.HANDLER:opportunity.VERSION,opportunity_market.HANDLER:opportunity_market.VERSION,opportunity_cj.HANDLER:opportunity_cj.VERSION,opportunity_orders.HANDLER:opportunity_orders.VERSION,opportunity_listings.HANDLER:opportunity_listings.VERSION}
    if skill.handler not in versions or skill.key!=opportunity.KEY or skill.version!=versions[skill.handler] or skill.status!='approved' or not skill.reviewed_by_id or not skill.review_note or skill.artifact_hash!=handler_hash(skill.handler):
        raise RuleError('选品 Skill 未审核、已停用或代码摘要改变。')

def selection_skill(binding, team):
    if (binding.get('skillId'),binding.get('skillVersion'))==('product.decision.landed-cost','1.0.0'):
        return None  # Keep historical frozen versions intact.
    try:
        key=binding.get('skillId','')
        if not key.startswith('registered.'):raise ValueError()
        skill=SkillVersion.objects.get(pk=UUID(key.removeprefix('registered.')),team=team,version=binding.get('skillVersion'),handler__in=[opportunity.HANDLER,opportunity_market.HANDLER,opportunity_cj.HANDLER,opportunity_orders.HANDLER,opportunity_listings.HANDLER])
    except (ValueError,TypeError,AttributeError,SkillVersion.DoesNotExist):
        raise RuleError('请选择已登记的“商品机会与售价建议” Skill；示例脚本不能用于真实执行。')
    check_skill(skill)
    return skill
