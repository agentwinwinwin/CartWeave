"""Explicitly confirmed deactivation through the same trusted installed store adapter."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from pydantic import Field, field_validator
from apps.common.utils import digest, parse
from apps.common.errors import RuleError, Conflict
from apps.identity.permissions import require_role
from apps.connections.services import check_store
from apps.integrations.registry import listing_adapter
from apps.integrations.test_store import UnknownResult
from apps.audit.models import AuditRecord
from contracts.listings import Contract
from contracts.store_api import ListingState, UnpublishReceipt
from .models import ChannelListing, ExternalOperation


class ConfirmUnpublish(Contract):
    expected_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    store_version: int = Field(ge=1, strict=True)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator('reason')
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError('需要明确的下架原因。')
        return value.strip()


def unpublish(member, actor, run_id, command):
    publication = get_object_or_404(ChannelListing.objects.select_related('run', 'store'), run_id=run_id, team=member.team)
    store = publication.store
    require_role(actor, member.team, ['approver'])
    check_store(store, command['store_version'])
    if not {'listing.unpublish', 'listing.status'} <= set(store.capabilities):
        raise RuleError('店铺尚未验收下架及状态查询能力，请先重新验收接口包。')
    if publication.evidence.get('digest') != command['expected_digest']:
        raise Conflict('商品版本已变化，请重新读取并确认下架。')
    key = digest({'action':'listing.unpublish', 'publication':str(publication.id), 'digest':command['expected_digest']})
    with transaction.atomic():
        operation, created = ExternalOperation.objects.get_or_create(store=store, key=key, defaults={
            'team':member.team, 'run':publication.run, 'request_digest':digest(command),
            'payload':{'action':'listing.unpublish', **command, 'external_id':publication.external_id, 'actor':str(actor.pk)},
        })
        operation = ExternalOperation.objects.select_for_update().get(pk=operation.pk)
        if operation.team_id != member.team_id or operation.run_id != publication.run_id or operation.payload.get('action') != 'listing.unpublish':
            raise Conflict('下架操作关联不一致。')
        if operation.payload.get('external_id') != publication.external_id or operation.payload.get('expected_digest') != command['expected_digest']:
            raise Conflict('原下架操作已绑定不同商品或内容版本。')
        if operation.payload['store_version'] != command['store_version']:
            raise Conflict('原下架操作的店铺版本已变化，需要先人工核对结果。')
        if operation.status == 'succeeded':
            return operation.status
        if created:
            AuditRecord.objects.create(team=member.team, actor=actor, action='listing.unpublish.confirmed',
                object_id=str(publication.id), metadata={'operation_id':str(operation.id), 'store_version':command['store_version'],
                    'digest':command['expected_digest'], 'reason':command['reason'], 'adapter':store.adapter})
        operation.status = 'unknown'  # Persist intent before any remote write.
        operation.save(update_fields=['status'])
    try:
        adapter = listing_adapter(store)
        # Always reconcile before retry, using the original product and stable key.
        state = parse(ListingState, adapter.listing_status(publication.external_id))
        def check(receipt):
            if receipt['external_id'] != publication.external_id or receipt['storefront_id'] != str(store.id) or receipt['digest'] != command['expected_digest'] or receipt['product_id'] != publication.evidence['product_id']:
                raise RuleError('渠道返回的商品、店铺或内容版本不匹配，不能标记下架成功。')
        check(state)
        if state['status'] == 'active':
            state = parse(UnpublishReceipt, adapter.unpublish({'external_id':publication.external_id,
                'expected_digest':command['expected_digest'], 'operation_key':key}))
            check(state)
        require_role(actor, member.team, ['approver'])
        check_store(store, command['store_version'])
        with transaction.atomic():
            current = ExternalOperation.objects.select_for_update().get(pk=operation.pk)
            if current.status != 'succeeded':
                current.status, current.receipt = 'succeeded', state
                current.save(update_fields=['status','receipt'])
                AuditRecord.objects.create(team=member.team, actor=actor, action='listing.unpublish.succeeded',
                    object_id=str(publication.id), metadata={'operation_id':str(operation.id), 'receipt':state})
        return 'succeeded'
    except UnknownResult:
        return 'unknown'  # Never claim success on timeouts or invent an inactive receipt.
