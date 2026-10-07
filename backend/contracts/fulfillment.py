"""Versioned shipment facts and local-test fulfillment commands; no supplier payment."""
from datetime import datetime
from uuid import UUID
from typing import Literal
from pydantic import Field, model_validator
from .listings import Contract
from .store_business import OrderFact, ShipmentFact, ShipmentPage

class Key(Contract):
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')

class OrderRef(Contract):
    order_id: UUID

class OrderLine(Contract):
    product_id: UUID
    sku: str = Field(min_length=1,max_length=160)
    quantity: int = Field(ge=1,le=20,strict=True)

class OrderDetail(Contract):
    storefront_id: UUID
    order: OrderFact
    lines: list[OrderLine] = Field(min_length=1,max_length=50)
    destination_country: Literal['US']
    test_payment: Literal[True]


class ShipmentRef(Contract):
    shipment_id: UUID

class FulfillCommand(Key,OrderRef):
    expected_order_revision: int = Field(ge=1,strict=True)
    test_execution_confirmed: Literal[True]

class RecordCommand(Key,ShipmentRef):
    expected_shipment_revision: int = Field(ge=1,strict=True)

class AdvanceCommand(ShipmentRef):
    expected_revision: int = Field(ge=1,strict=True)
    status: Literal['dispatched','in_transit','delivered','exception']
    test_data_confirmed: Literal[True]

FULFILLMENT_ACTIONS={
    'order.detail':(OrderRef,OrderDetail),
    'fulfillment.create':(FulfillCommand,ShipmentFact),
    'fulfillment.lookup':(Key,ShipmentFact),
    'shipment.read':(ShipmentRef,ShipmentFact),
    'fulfillment.record':(RecordCommand,OrderFact),
}
