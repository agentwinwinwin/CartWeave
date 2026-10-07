from typing import Literal
from uuid import UUID
from pydantic import Field
from .listings import Contract

Protocol = Literal['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']


class ModelSettings(Contract):
    name: str = Field(min_length=1, max_length=80)
    protocol: Protocol
    base_url: str = Field(min_length=1, max_length=300)
    model_id: str = Field(min_length=1, max_length=120, pattern=r'^[a-zA-Z0-9._:/-]+$')
    api_key: str = Field(default='', max_length=1000)


class MappingStart(Contract):
    channel: str = Field(min_length=1, max_length=80)
    action: Literal['store.package', 'listing.validate', 'listing.publish', 'listing.wait', 'publication.lookup', 'listing.unpublish', 'listing.status', 'orders.read', 'customers.read', 'finance.read'] = 'store.package'


class MappingTurn(Contract):
    connection_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    message: str = Field(min_length=1, max_length=30000)


class FieldMapping(Contract):
    action: Literal['listing.validate', 'listing.publish', 'listing.wait', 'publication.lookup', 'listing.unpublish', 'listing.status', 'orders.read', 'customers.read', 'finance.read', 'shipments.read', 'order.detail', 'fulfillment.create', 'fulfillment.lookup', 'shipment.read', 'fulfillment.record', 'test.order.create', 'support.receive', 'support.messages', 'support.context', 'support.reply', 'support.reply.lookup', 'materials.save', 'materials.lookup', 'test.records', 'support.message-feed', 'test.shipment.advance'] | None = None
    direction: Literal['request', 'response']
    fixed_path: str = Field(min_length=1, max_length=200)
    external_path: str = Field(max_length=300)
    meaning: str = Field(min_length=1, max_length=1000)
    conversion: str = Field(max_length=1000)
    evidence: str = Field(max_length=1000)
    status: Literal['direct', 'convert', 'question', 'unsupported']


class MappingAnswer(Contract):
    summary: str = Field(min_length=1, max_length=4000)
    mappings: list[FieldMapping] = Field(max_length=500)
    questions: list[str] = Field(max_length=20)
    limitations: list[str] = Field(max_length=20)
