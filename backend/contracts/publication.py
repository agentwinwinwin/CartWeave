from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID
from contracts.listings import Listing

class PreparedPublication(BaseModel):
    model_config=ConfigDict(extra='forbid')
    listing: Listing
    listing_digest: str=Field(pattern=r'^[0-9a-f]{64}$')
    approval_digest: str=Field(pattern=r'^[0-9a-f]{64}$')
    store_id: UUID
    store_version: int=Field(strict=True,ge=1)
    package: Literal['test-store.v1']
    package_version: str
