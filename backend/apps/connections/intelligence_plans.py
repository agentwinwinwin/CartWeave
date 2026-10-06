"""Immutable operator-confirmed category correspondence; no fuzzy/model guesses."""
import json
from uuid import UUID, uuid4
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from apps.common.errors import RuleError
from apps.common.utils import digest
from . import cj_intelligence as browser
from .cj_catalog import catalog, connection_for


class CategoryMapping(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    source_category_id: str = Field(min_length=1, max_length=100)
    category_id: str = Field(min_length=1, max_length=200)


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: Literal['sales', 'advertising']
    mappings: list[CategoryMapping] = Field(min_length=1, max_length=10)


def create(member, payload):
    browser.require_desktop()
    try:
        request = PlanRequest.model_validate(payload)
    except ValidationError:
        raise RuleError('请从销售榜或广告榜选择 1–10 个方向，并指定各自的 CJ 供货类目。') from None
    snapshot = browser.status(member.team_id)['snapshot']
    if not snapshot:
        raise RuleError('请先采集两组榜单，不使用演示榜单配置真实任务。')
    rows = {r['source_category_id']: r for r in snapshot[request.source]['rows']}
    directory = catalog(member)
    categories = {r['id']: r for r in directory['categories']}
    if len({r.source_category_id for r in request.mappings}) != len(request.mappings):
        raise RuleError('榜单方向不可重复。')
    mappings = []
    for mapping in request.mappings:
        if mapping.source_category_id not in rows or mapping.category_id not in categories:
            raise RuleError('榜单方向或 CJ 类目已变化，请刷新后重新确认。')
        row, category = rows[mapping.source_category_id], categories[mapping.category_id]
        mappings.append({**mapping.model_dump(), 'source_name': row['category_name'],
                         'rank': row['rank'], 'category_path': category['path']})
    mappings.sort(key=lambda r: r['rank'])
    result = {'id': str(uuid4()), 'schema_version': 'cj.category-plan@1', 'source': request.source,
              'connection_version': directory['connection_version'], 'mappings': mappings,
              'captured_at': snapshot['captured_at'], 'snapshot_digest': digest(snapshot)}
    root = browser.folder(member.team_id) / 'plans'
    root.mkdir(mode=0o700, exist_ok=True)
    browser.write_private(root / (result['id'] + '.json'), json.dumps(result, ensure_ascii=False))
    return result


def read(team_id, reference):
    try:
        key = str(UUID(str(reference)))
        data = json.loads((browser.folder(team_id) / 'plans' / (key + '.json')).read_text())
        if data['id'] != key or data['schema_version'] != 'cj.category-plan@1':
            raise ValueError()
        PlanRequest.model_validate({'source': data['source'], 'mappings': [
            {k: r[k] for k in ('source_category_id', 'category_id')} for r in data['mappings']]})
        if len({r['source_category_id'] for r in data['mappings']}) != len(data['mappings']):
            raise ValueError()
        return data
    except (ValueError, OSError, KeyError, TypeError):
        raise RuleError('行情类目方案不可用，请在首节点重新确认；不会回退到搜索词。') from None


def queries(plan):
    # Multiple market directions can deliberately map to one supplier leaf.
    return [{'categoryId': key, 'keyword': ''} for key in dict.fromkeys(r['category_id'] for r in plan['mappings'])]


def execute(run):
    from apps.registry.launch import parameters
    from apps.identity.models import Membership
    config = parameters(run.version.document, 'market.intelligence')
    if not config.get('enabled', False):
        return {'market_intelligence': {'status': 'skipped', 'reason': '未启用，沿用商品任务搜索词'}}
    plan = read(run.team_id, config.get('categoryPlanRef'))
    member = Membership.objects.get(team=run.team, user=run.requested_by, active=True)
    if connection_for(member).configuration_version != plan['connection_version']:
        raise RuleError('CJ 连接已变化，请重新确认行情类目方案。')
    snapshot = browser.collect(run.team_id)
    current = {r['source_category_id']: r for r in snapshot[plan['source']]['rows']}
    for row in plan['mappings']:
        if row['source_category_id'] not in current or current[row['source_category_id']]['category_name'] != row['source_name']:
            return {'market_intelligence': {'status': 'needs_mapping', 'snapshot': snapshot},
                    '_research_required': True, '_research_message': '所选方向已不在当前前十或名称变化，请重新确认类目方案后启动新运行。'}
    directory = {r['id'] for r in catalog(member)['categories']}
    if any(r['category_id'] not in directory for r in plan['mappings']):
        raise RuleError('CJ 供货类目不再有效，请重新确认方案。')
    return {'market_intelligence': {'status': 'ready', 'snapshot': snapshot,
            'plan_ref': plan['id'], 'source': plan['source'], 'category_queries': queries(plan), 'mappings': plan['mappings']}}
