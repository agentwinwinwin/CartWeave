from typing import Literal
from uuid import UUID
from pydantic import Field
from .listings import Contract


class OperationRequest(Contract):
    request_key: UUID
    message: str = Field(default='', max_length=4000)
    mode: Literal['fixture', 'pi'] = 'fixture'
    connection_id: UUID | None = None
    sample_knowledge_confirmed: bool = False
    currency: Literal['USD', 'EUR', 'GBP', 'CNY'] = 'USD'
    store_id: UUID | None = None
    message_id: UUID | None = None


class GroundedReply(Contract):
    schema_version: Literal['GroundedSupportReply@1']
    reply: str = Field(min_length=1, max_length=8000)
    citations: list[str] = Field(max_length=6)
    questions: list[str] = Field(max_length=10)
    handoff_required: bool


class SupportConfirmation(Contract):
    confirmed: bool = Field(strict=True)
    expected_revision: int = Field(ge=1, strict=True)
