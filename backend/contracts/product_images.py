from typing import Literal
from uuid import UUID
from pydantic import Field, model_validator
from .listings import Contract


class ImageBatchStart(Contract):
    design_id: str = Field(min_length=1,max_length=100)
    product_ids: list[UUID] = Field(min_length=1, max_length=500)
    planner_id: UUID
    planner_skill: Literal['product_image_batch', 'product_image_photography'] = 'product_image_batch'
    generator_id: UUID
    images_per_product: int = Field(default=1, ge=1, le=5, strict=True)
    usage: Literal['main', 'detail', 'scene'] = 'main'
    size: Literal['1024x1024', '1024x1536', '1536x1024'] = '1024x1024'
    quality: Literal['low', 'medium', 'high'] = 'medium'
    requirements: str = Field(default='', max_length=2000)
    idempotency_key: UUID

    @model_validator(mode='after')
    def unique_products(self):
        if len(set(self.product_ids)) != len(self.product_ids):
            raise ValueError('商品不可重复')
        return self


class ImageShot(Contract):
    prompt: str = Field(min_length=1, max_length=4000)
    preserve: list[str] = Field(max_length=20)
    forbidden_changes: list[str] = Field(max_length=20)


class ImagePlanV2(Contract):
    schema_version: Literal['ProductImagePlan@2']
    shots: list[ImageShot] = Field(min_length=1, max_length=5)
    questions: list[str] = Field(max_length=20)


class ImageBatchCommand(Contract):
    expected_revision: int = Field(ge=1, strict=True)
    action: Literal['generate', 'deliver', 'cancel']
    asset_ids: list[UUID] = Field(default_factory=list, max_length=2500)
    confirmed: bool = False
