"""Built-in, code-owned model profiles. NOT workflow SkillVersion handlers.

No uploaded scripts or arbitrary filesystem skill discovery. A prompt change
invalidates old session fingerprints; a new conversation is required.
"""
import hashlib
from pathlib import Path
from apps.common.errors import RuleError

ROOT=Path(__file__).parent/'rules'
PROFILES={
    'assistant':('运营助手','assistant',None),
    'customer_support':('智能客服 · 回复建议','customer-support', 'SupportReply@1'),
    'product_image_plan':('商品图 · 生成方案','product-image-plan', 'ProductImagePlan@1'),
}


def profile(purpose):
    if purpose not in PROFILES: raise RuleError('未登记的运行时模型 Skill。')
    title,folder,output=PROFILES[purpose]
    text=(ROOT/folder/'SKILL.md').read_text(encoding='utf-8')
    return {'id':purpose,'title':title,'version':'1.0.0','kind':'runtime-model-policy',
        'digest':hashlib.sha256(text.encode()).hexdigest(),'output':output,'instructions':text,
        'tools':[],'scope':'draft-only'}


def public_profiles():
    return [{k:v for k,v in profile(p).items() if k!='instructions'} for p in PROFILES]
