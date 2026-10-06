from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Money = Annotated[Decimal, Field(ge=0, max_digits=16, decimal_places=2)]


class FinancialFact(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    external_order_id: str = Field(min_length=1, max_length=160)
    source_event_id: str = Field(min_length=1, max_length=160)
    source_ref: str = Field(min_length=1, max_length=500)
    revision: int = Field(ge=1, strict=True)
    paid_at: datetime
    observed_at: datetime
    currency: Literal['USD', 'EUR', 'GBP', 'CNY']
    paid_total: Money
    tax_collected: Money
    refund_total: Money
    tax_refunded: Money
    procurement: Money | None = None
    shipping: Money | None = None
    platform_payment: Money | None = None
    advertising: Money | None = None
    other: Money | None = None

    @model_validator(mode='after')
    def consistent(self):
        if any(d.tzinfo is None or d.utcoffset() is None for d in (self.paid_at, self.observed_at)):
            raise ValueError('时间必须带时区。')
        if self.observed_at < self.paid_at:
            raise ValueError('观测时间不得早于付款时间。')
        if self.tax_collected > self.paid_total or self.refund_total > self.paid_total:
            raise ValueError('税款或退款超过原收款。')
        if self.tax_refunded > min(self.tax_collected, self.refund_total):
            raise ValueError('退税超过税款或退款。')
        if self.paid_total-self.tax_collected-self.refund_total+self.tax_refunded < 0:
            raise ValueError('净销售额不一致。')
        return self
