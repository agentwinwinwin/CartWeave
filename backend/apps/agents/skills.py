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
    'product_image_batch':('商品图 · 逐张制作方案','product-image-batch', 'ProductImagePlan@2'),
    'product_image_photography':('商品摄影 · 开源模板','product-image-photography', 'ProductImagePlan@2'),
    'customer_support_rag':('智能客服 · 引用知识库','customer-support-rag', 'GroundedSupportReply@1'),
}


def profile(purpose):
    if purpose not in PROFILES: raise RuleError('未登记的运行时模型 Skill。')
    title,folder,output=PROFILES[purpose]
    text=(ROOT/folder/'SKILL.md').read_text(encoding='utf-8')
    return {'id':purpose,'title':title,'version':'3.0.0' if purpose=='product_image_photography' else '2.0.0' if purpose=='product_image_batch' else '1.0.0','kind':'runtime-model-policy',
        'digest':hashlib.sha256(text.encode()).hexdigest(),'output':output,'instructions':text,
        'tools':[],'scope':'draft-only'}


def public_profiles():
    return [{k:v for k,v in profile(p).items() if k!='instructions'} for p in PROFILES]
