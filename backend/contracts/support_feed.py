"""Additive event feed; does not change the already-enrolled testing@1 contract."""
from uuid import UUID
from typing import Literal
from pydantic import Field
from .listings import Contract
from .store_testing import InboxMessage

class FeedInput(Contract):
    cursor: UUID | None = None

class FeedMessage(InboxMessage):
    answered: bool

class MessageFeed(Contract):
    schema_version: Literal['TestSupportMessageFeed@1'] = 'TestSupportMessageFeed@1'
    storefront_id: UUID
    messages: list[FeedMessage] = Field(max_length=50)
    next_cursor: UUID | None
    has_more: bool
