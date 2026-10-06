from decimal import Decimal
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Variant(Contract):
    sku: str = Field(min_length=1, max_length=100)
    size: str = Field(min_length=1, max_length=40)
    cj_pid: str = Field(min_length=1, max_length=100)
    cj_vid: str = Field(min_length=1, max_length=100)
    price: Decimal = Field(gt=0, le=100000, decimal_places=2)
    inventory: int = Field(strict=True, ge=0, le=100000)

class Brief(Contract):
    schema_version: Literal['ProductBrief@1'] = 'ProductBrief@1'
    product_id: str = Field(min_length=1, max_length=100, pattern=r'^[a-zA-Z0-9_-]+$')
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    selling_points: list[str] = Field(min_length=1, max_length=10)
    images: list[str] = Field(min_length=1, max_length=8)
    currency: Literal['USD'] = 'USD'
    market: Literal['US'] = 'US'
    variants: list[Variant] = Field(min_length=1, max_length=50)
    source_kind: Literal['test_fixture', 'manual_evidence', 'cj_selection']
    evidence_ref: str = Field(min_length=1, max_length=500)
    source_note: str = Field(min_length=1, max_length=1000)

    @field_validator('title', 'description', 'evidence_ref', 'source_note')
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError('字段不能仅为空白。')
        return value.strip()

    @field_validator('images')
    @classmethod
    def safe_images(cls, value):
        # Phase-one assets are served locally; arbitrary remote URLs are not accepted.
        from .assets import allowed_image
        for image in value:
            if not allowed_image(image):
                raise ValueError('图片必须为已有测试素材或受信 CJ HTTPS 原图。')
        return value

    @model_validator(mode='after')
    def unique_variants(self):
        if len({v.sku for v in self.variants}) != len(self.variants) or len({v.cj_vid for v in self.variants}) != len(self.variants) or len({v.size for v in self.variants}) != len(self.variants):
            raise ValueError('SKU、CJ 规格和尺码必须各自唯一。')
        return self

class Listing(Contract):
    schema_version: Literal['ListingDraft@1'] = 'ListingDraft@1'
    product_id: str
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    bullets: list[str] = Field(min_length=1, max_length=10)
    images: list[str] = Field(min_length=1, max_length=8)
    currency: Literal['USD']
    market: Literal['US']
    variants: list[Variant] = Field(min_length=1, max_length=50)

class PublicationReceipt(Contract):
    external_id: UUID
    product_id: str = Field(min_length=1, max_length=100)
    digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    status: Literal['active']
    storefront_id: UUID

class PublishedEvidence(PublicationReceipt):
    listing: Listing

def check_listing(listing, brief):
    from apps.common.errors import RuleError
    for field in ('product_id', 'currency', 'market', 'variants'):
        if listing[field] != brief[field]:
            raise RuleError(f'内容不能改变已确认的 {field}，请重新确认商品方案。')
    if not set(listing['images']) <= set(brief['images']) or not listing['title'].strip() or not listing['description'].strip():
        raise RuleError('素材或内容不符合已确认商品方案。')
