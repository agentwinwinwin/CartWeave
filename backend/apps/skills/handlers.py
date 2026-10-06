"""Closed registry: no eval, uploaded code, shell, model credential or dynamic imports."""
import hashlib
from pathlib import Path
from apps.common.errors import RuleError

def editorial_copy(brief, parameters):
    return {
        'schema_version': 'ListingDraft@1', 'product_id': brief['product_id'],
        'title': brief['title'], 'description': brief['description'],
        'bullets': brief['selling_points'], 'images': brief['images'],
        'currency': brief['currency'], 'market': brief['market'], 'variants': brief['variants'],
    }

HANDLERS = {'content.editorial.v1': editorial_copy}

def handler_hash(key):
    if key not in HANDLERS:
        raise RuleError('未注册的执行入口。')
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

def check_skill(skill):
    # Never trust a cached model instance after a concurrent revocation/review.
    skill.refresh_from_db()
    if skill.status != 'approved' or not skill.reviewed_by_id or not skill.review_note or skill.artifact_hash != handler_hash(skill.handler):
        raise RuleError('Skill 未审核、已停用或产物哈希改变。')

def execute(skill, brief, parameters):
    check_skill(skill)
    return HANDLERS[skill.handler](brief, parameters)
