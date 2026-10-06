"""Trusted channel adapters installed by the server, never imported from a draft."""
from typing import Protocol

from apps.common.errors import RuleError
from .test_store import TestStoreAdapter


class ListingAdapter(Protocol):
    def validate(self, listing: dict) -> dict: ...
    def lookup(self, key: str) -> dict | None: ...
    def publish(self, operation) -> dict: ...
    def verify(self, external_id: str, listing_digest: str) -> dict: ...
    def listing_status(self, external_id: str) -> dict: ...
    def unpublish(self, command: dict) -> dict: ...


ADAPTERS = {'test-store.v1': TestStoreAdapter}


def listing_adapter(store) -> ListingAdapter:
    """Adding a channel requires reviewed code plus connection capability checks."""
    adapter = ADAPTERS.get(store.adapter)
    if adapter is None:
        raise RuleError('店铺适配器尚未安装或未受信。')
    return adapter(store)
