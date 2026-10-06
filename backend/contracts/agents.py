from typing import Literal
from uuid import UUID
from pydantic import Field
from .listings import Contract

Purpose=Literal['assistant','customer_support','product_image_plan']


class AgentStart(Contract):
    purpose: Purpose = 'assistant'


class AgentTurn(Contract):
    connection_id: UUID
    expected_revision: int = Field(ge=1,strict=True)
    message: str = Field(min_length=1,max_length=12000)


class SupportReply(Contract):
    schema_version: Literal['SupportReply@1']
    reply: str = Field(min_length=1,max_length=8000)
    facts_used: list[str] = Field(max_length=20)
    questions: list[str] = Field(max_length=20)
    handoff_required: bool


class ImagePlan(Contract):
    schema_version: Literal['ProductImagePlan@1']
    prompt: str = Field(min_length=1,max_length=8000)
    preserve: list[str] = Field(max_length=20)
    forbidden_changes: list[str] = Field(max_length=20)
    questions: list[str] = Field(max_length=20)
