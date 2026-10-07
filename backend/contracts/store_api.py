"""Executable storefront HTTP contracts, separate from v2 workflow design envelopes."""
from typing import Literal
from uuid import UUID
from pydantic import Field
from .listings import Contract, Listing, PublicationReceipt, PublishedEvidence
from .store_business import ReadPage, BUSINESS_ACTIONS


class ValidateCommand(Contract):
    listing: Listing


class PublishCommand(ValidateCommand):
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')


class WaitCommand(Contract):
    external_id: UUID


class LookupCommand(Contract):
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')


class ValidationReceipt(Contract):
    valid: Literal[True]
    digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    adapter: Literal['test-store.v1']


class UnpublishCommand(WaitCommand):
    operation_key: str = Field(pattern=r'^[a-f0-9]{64}$')
    expected_digest: str = Field(pattern=r'^[a-f0-9]{64}$')


class ListingState(Contract):
    external_id: UUID
    product_id: str
    digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    storefront_id: UUID
    status: Literal['active', 'inactive']


class UnpublishReceipt(ListingState):
    status: Literal['inactive']


ACTION_CONTRACTS = {
    'listing.validate': (ValidateCommand, ValidationReceipt),
    'listing.publish': (PublishCommand, PublicationReceipt),
    'listing.wait': (WaitCommand, PublishedEvidence),
    'publication.lookup': (LookupCommand, PublicationReceipt),
    'listing.unpublish': (UnpublishCommand, UnpublishReceipt),
    'listing.status': (WaitCommand, ListingState),
}
ACTION_CONTRACTS.update({action:(ReadPage,models[2]) for action,models in BUSINESS_ACTIONS.items()})
from .fulfillment import FULFILLMENT_ACTIONS
ACTION_CONTRACTS.update(FULFILLMENT_ACTIONS)


def publication_package_compatible(package, version):
    # 1.4 only adds read-only business exports; the 1.3 publication wire
    # contracts and registered publication descriptors are unchanged.
    # Explicit audited compatibility, not a semver range or fallback upgrade.
    return package == 'test-store.v1' and version in ('1.3.0', '1.4.0', '1.5.0')


def package_contract():
    return {
        'format': 'commerceos.store-api@1', 'package': 'test-store.v1', 'version': '1.5.0',
        'channel': 'test-store', 'status': 'implemented-local-test-only',
        'scope': 'publication-business-sync-and-local-fulfillment',
        'authentication': 'Server-side Bearer token bound to one storefront; never supplied by a workflow draft.',
        'authorization': 'Only trusted workflow service holds write credentials. It verifies approvals before publishing. A client approved flag grants no authority.',
        'compatibility': 'These are HTTP wire contracts, not the v2 workflow envelopes with similarly named schemas. Do not interchange them.',
        # UI-only role descriptors for an installed package; not executable v2 versions.
        'design_manifests': [
            {'id':f'installed.test-store.v1.{action}', 'name':f'测试站接口包 · {title}',
             'version':'1.3.0', 'runtime':'connector',
             'description':'已安装测试站代码的画布设计描述；真实执行使用服务端七步模板与实际 HTTP 契约，不直接执行 v2 草稿。',
             'input':input_contract, 'output':output_contract,
             'entrypointRef':f'installed://test-store.v1/{action}@1.3.0',
             'parameterSchema':{}, 'capabilities':[], 'effects':effects, 'channels':['test-store']}
            for action,title,input_contract,output_contract,effects in [
                ('listing.validate','渠道检查','ListingDraft@1','ValidatedListing@1',['read']),
                ('listing.publish','提交发布','PreparedChannelPublication@1','PublicationReceipt@1',['read','remote_write']),
                ('listing.wait','可售确认','PublicationReceipt@1','PublishedProduct@1',['read'])]],
        'actions': [{'action': action, 'method': 'POST',
                     'path': f'/api/test-store/v1/actions/{action}',
                     'inputSchema': request.model_json_schema(mode='validation'),
                     'outputSchema': response.model_json_schema(mode='serialization')}
                    for action, (request, response) in ACTION_CONTRACTS.items()],
        'extensions': operational_extensions(),
        'unsupported': ['supplier.purchase', 'supplier.pay', 'email.send', 'advertising.execute', 'insight.apply'],
        'constraints': ['Publication is USD / US only; read-only business facts support USD / EUR / GBP / CNY', 'Existing local test-store images or allowlisted HTTPS CJ CDN originals; no arbitrary backend URL fetching',
                       'Create-only: a new key cannot overwrite an existing product',
                       'Same operation key + same normalized payload returns existing result; different payload returns 409',
                       'Timeout is unknown: query publication.lookup with the original operation key before retry',
                       'Unpublish uses a separate confirmed command bound to external_id and approved content digest; never deletes products or republishes them',
                       'Orders/customers/finance exports are authenticated, incremental facts; no demo checkout or estimate ingestion',
                       'Fulfillment is local test shipping only; carrier events require explicit test input, not elapsed time',
                       'No real payment, supplier purchasing, physical shipping, mail or advertising execution'],
        'errors': {'400': 'Invalid fields or business input', '401': 'Missing, invalid or revoked token',
                   '404': 'No result in this storefront', '409': 'Idempotency conflict or existing product',
                   '429': 'Rate limited', '501': 'Unsupported action'},
    }

def operational_extensions():
    # Included in one downloadable bundle, with separate enrollment and unchanged @1 schemas.
    from .store_testing import contract
    from .support_feed import FeedInput,MessageFeed
    from .fulfillment import AdvanceCommand,ShipmentFact
    return [contract(),{'package':'test-store.events','version':'1.0.0','scope':'local-test-only',
        'actions':[{'action':'support.message-feed','method':'POST','path':'/api/test-store/v1/testing/message-feed',
                    'inputSchema':FeedInput.model_json_schema(),'outputSchema':MessageFeed.model_json_schema()},
                   {'action':'test.shipment.advance','method':'POST','path':'/api/test-store/v1/testing/shipment-advance',
                    'inputSchema':AdvanceCommand.model_json_schema(),'outputSchema':ShipmentFact.model_json_schema()}]}]

def mapping_actions():
    package=package_contract()
    return package['actions']+[action for extension in package['extensions'] for action in extension['actions']]
