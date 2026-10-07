"""Read-only commerce facts. No payment or fulfillment command is granted here."""
from datetime import datetime
from uuid import UUID
from typing import Literal
from pydantic import Field, model_validator
from .listings import Contract
from .finance import Money, FinancialFact


class ReadPage(Contract):
    cursor: str = Field(default='0', pattern=r'^\d{1,20}$')
    limit: int = Field(default=50, ge=1, le=50, strict=True)

    @model_validator(mode='after')
    def bounded_cursor(self):
        if int(self.cursor)>9223372036854775807:raise ValueError('游标超出来源范围。')
        return self


class SourceFact(Contract):
    external_id: str = Field(min_length=1, max_length=160)
    revision: int = Field(ge=1, strict=True)
    observed_at: datetime
    source_ref: str = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def aware(self):
        if self.observed_at.tzinfo is None:raise ValueError('观测时间必须带时区。')
        return self


class OrderFact(SourceFact):
    ordered_at: datetime
    customer_id: str | None = Field(default=None, max_length=160)
    customer_name: str | None = Field(default=None, max_length=160)
    currency: Literal['USD','EUR','GBP','CNY']
    total: Money
    payment_status: Literal['pending','paid','partially_refunded','refunded','cancelled','unknown']
    fulfillment_status: Literal['unfulfilled','partial','fulfilled','delivered','cancelled','unknown']
    tracking_number: str | None = Field(default=None, max_length=160)
    item_summary: str = Field(max_length=500)

    @model_validator(mode='after')
    def order_time(self):
        if self.ordered_at.tzinfo is None or self.ordered_at>self.observed_at:raise ValueError('下单时间须带时区且不得晚于观测时间。')
        return self


class CustomerFact(SourceFact):
    name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=254)
    country: str | None = Field(default=None, pattern=r'^[A-Z]{2}$')
    status: Literal['active','deleted'] = 'active'


class OrderPage(Contract):
    items: list[OrderFact] = Field(max_length=50)
    next_cursor: str = Field(pattern=r'^\d{1,20}$')
    has_more: bool = Field(strict=True)


class CustomerPage(OrderPage):
    items: list[CustomerFact] = Field(max_length=50)


class FinancePage(OrderPage):
    items: list[FinancialFact] = Field(max_length=50)


class TrackingEvent(Contract):
    status: Literal['dispatched','in_transit','delivered','exception']
    occurred_at: datetime
    description: str = Field(min_length=1,max_length=300)

    @model_validator(mode='after')
    def aware(self):
        if self.occurred_at.tzinfo is None: raise ValueError('物流时间须带时区。')
        return self

class ShipmentFact(SourceFact):
    schema_version: Literal['ShipmentFact@1']='ShipmentFact@1'
    storefront_id: UUID
    order_id: UUID
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')
    status: Literal['prepared','dispatched','in_transit','delivered','exception']
    carrier: Literal['TEST CARRIER']='TEST CARRIER'
    tracking_number: str = Field(min_length=1,max_length=160)
    events: list[TrackingEvent] = Field(max_length=20)
    simulated: Literal[True]=True

    @model_validator(mode='after')
    def timeline(self):
        times=[e.occurred_at for e in self.events]
        if times!=sorted(times) or any(t>self.observed_at for t in times): raise ValueError('物流事件时间顺序无效。')
        if self.status=='prepared' and self.events or self.status!='prepared' and (not self.events or self.events[-1].status!=self.status): raise ValueError('状态必须对应实际物流事件。')
        return self

class ShipmentPage(OrderPage):
    items: list[ShipmentFact] = Field(max_length=50)

BUSINESS_ACTIONS = {'orders.read':('orders',OrderFact,OrderPage),
    'customers.read':('customers',CustomerFact,CustomerPage),
    'finance.read':('finance',FinancialFact,FinancePage)}

# Separate versioned shipment envelope; original OrderFact wire fields stay unchanged.
BUSINESS_ACTIONS['shipments.read']=('shipments',ShipmentFact,ShipmentPage)
