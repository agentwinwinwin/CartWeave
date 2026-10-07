"""Additive local-store test interfaces; publication contracts remain unchanged."""
from typing import Literal, Generic, TypeVar
from datetime import datetime
from uuid import UUID
from pydantic import Field
from .listings import Contract
from .finance import Money
from .store_business import OrderFact

class Key(Contract):
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')

class TestOrder(Key):
    product_id: UUID
    quantity: int = Field(ge=1, le=20, strict=True)
    procurement: Money | None = None
    shipping: Money | None = None
    platform_payment: Money | None = None
    advertising: Money | None = None
    other: Money | None = None
    test_data_confirmed: Literal[True]

class CustomerMessage(Key):
    message: str = Field(min_length=1, max_length=4000)
    order_id: UUID | None = None
    test_data_confirmed: Literal[True]

class MessageRef(Contract):
    message_id: UUID

class Reply(Key, MessageRef):
    reply: str = Field(min_length=1, max_length=8000)
    context_digest: str = Field(pattern=r'^[a-f0-9]{64}$')

class Material(Key):
    product_id: UUID
    batch_id: UUID
    asset_id: UUID
    png_base64: str = Field(min_length=1, max_length=12000000)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    appearance_confirmed: Literal[True]

class Empty(Contract):
    pass

T=TypeVar('T')
class ExchangeResult(Contract, Generic[T]):
    schema_version: Literal['TestStoreExchange@1'] = 'TestStoreExchange@1'
    storefront_id: UUID
    result: T

class InboxMessage(Contract):
    id: UUID
    message: str = Field(min_length=1,max_length=4000)
    order_id: UUID | None
    received_at: datetime
    channel: Literal['test-inbox']

class Inbox(Contract):
    messages: list[InboxMessage] = Field(max_length=50)

class Passage(Contract):
    id: str
    text: str
    digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    source: str

class SupportContext(Contract):
    message_id: UUID
    message: str
    order: OrderFact | None
    policy: list[Passage] = Field(max_length=3)
    policy_scope: Literal['Northwind test policy; not production merchant policy']
    source: Literal['test-store-http']
    context_digest: str = Field(pattern=r'^[a-f0-9]{64}$')

class ReplyReceipt(Contract):
    message_id: UUID
    reply: str = Field(min_length=1,max_length=8000)
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')
    status: Literal['stored-in-test-inbox']
    delivered_at: datetime
    email_sent: Literal[False]

class MaterialReceipt(Contract):
    product_id: UUID
    batch_id: UUID
    asset_id: UUID
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    status: Literal['archived-not-published']
    received_at: datetime

class OrderReceipt(Contract):
    id: UUID
    order: OrderFact
    test_payment: Literal[True]
    source_ref: str
    product_id: UUID

ACTIONS = {'test.order.create': TestOrder, 'support.receive': CustomerMessage,
    'support.messages': Empty, 'support.context': MessageRef,
    'support.reply': Reply, 'support.reply.lookup': Key,
    'materials.save': Material, 'materials.lookup': Key, 'test.records': Empty}

RESULTS={'test.order.create':OrderReceipt,'support.receive':InboxMessage,'support.messages':Inbox,
    'support.context':SupportContext,'support.reply':ReplyReceipt,'support.reply.lookup':ReplyReceipt,
    'materials.save':MaterialReceipt,'materials.lookup':MaterialReceipt,'test.records':dict}

def envelope(action):
    return ExchangeResult[RESULTS[action]]

def contract():
    return {'package':'test-store.testing', 'version':'1.0.0', 'scope':'local-test-only',
        'actions':[{'action':name,'method':'POST','path':'/api/test-store/v1/testing/actions/'+name,
            'inputSchema':model.model_json_schema(), 'outputSchema':envelope(name).model_json_schema()}
            for name,model in ACTIONS.items()],
        'constraints':['Explicit local test enrollment, no live payment or email',
            'Test financial facts are labeled test-store://; missing costs remain null',
            'Reply receipt means stored in test inbox, not email delivery',
            'Materials archived separately; no mutation of published listing or digest']}
