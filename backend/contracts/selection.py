from decimal import Decimal
from typing import Literal
from pydantic import Field
from apps.connections.cj_catalog import ProductSearch


class SelectionQuery(ProductSearch):
    # Explicit bounded task, not a preview silently promoted to full catalog ingestion.
    limit: int = Field(default=3, ge=1, le=100, strict=True)
    variants_per_product: int = Field(default=2, ge=1, le=20, strict=True)
    market: Literal['US'] = 'US'
    requestedCurrency: Literal['USD'] = 'USD'
    minimum_inventory: int = Field(default=5, ge=1, le=100000, strict=True)
    allow_factory_supply: bool = Field(default=False, strict=True)
    factory_processing_days: int | None = Field(default=None, ge=0, le=60, strict=True)
    factory_sale_limit: int | None = Field(default=None, ge=1, le=1000, strict=True)
    maximum_days: int = Field(default=20, ge=1, le=90, strict=True)
    fee_percent: Decimal = Field(ge=0, le=30)
    margin_percent: Decimal = Field(gt=0, le=50)
    tax_reserve_usd: Decimal | None = Field(default=None, ge=0, le=10000, decimal_places=2)
    strategy: Literal['landed-cost.v1','product.opportunity.v1','product.opportunity.v2','product.opportunity.v3','product.opportunity.v4','product.opportunity.v5'] = 'landed-cost.v1'
    demand_first_collection: bool = Field(default=False, strict=True)
    minimum_cj_order_count: int = Field(default=1, ge=1, le=100000000, strict=True)
    batch_target: int = Field(default=0, ge=0, le=100, strict=True)
    final_selection_mode: Literal['per_category','global'] = 'per_category'
    scan_budget: int | None = Field(default=None, ge=20, le=10000, strict=True)
    demand_quota: bool = Field(default=False, strict=True)
