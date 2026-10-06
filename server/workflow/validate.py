"""Validate workflow definitions, not live platform permissions or execution results.

The registry is loaded from the server filesystem. Clients cannot redefine handlers,
ports or channel permissions by changing their card labels.
"""
import json
import sys
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError

CATALOG = json.loads((Path(__file__).resolve().parents[2] / 'lib/workflow/catalog.json').read_text())
DEFINITIONS = {item['id']: item for item in CATALOG['definitions']}
TEMPLATES = {item['id']: item for item in CATALOG['templates']}
SKILLS = {item['id']: item for item in CATALOG['skills']}
PROFILES = {item['id']: item for item in CATALOG['profiles']}

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class Config(StrictModel):
    market: str = Field(default='', max_length=120)
    instruction: str = Field(default='', max_length=4000)
    timeout: int = Field(default=60, ge=1, le=600)
    retries: int = Field(default=1, ge=0, le=3)
    threshold: int = Field(default=80, ge=0, le=100)

class Node(StrictModel):
    id: str = Field(min_length=1, max_length=100, pattern=r'^[\w.-]+$')
    definitionId: str = Field(min_length=1, max_length=120)
    definitionVersion: Literal['1'] = '1'
    title: str = Field(min_length=1, max_length=80)
    skillId: str | None = None
    config: Config = Field(default_factory=Config)

class Edge(StrictModel):
    id: str = Field(min_length=1, max_length=220)
    source: str
    target: str
    kind: Literal['forward', 'feedback', 'collaboration']
    label: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=1000)

class Draft(StrictModel):
    schemaVersion: Literal['1']
    id: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=1)
    profileId: str
    templateId: str
    title: str = Field(min_length=1, max_length=100)
    nodes: list[Node] = Field(min_length=2, max_length=40)
    edges: list[Edge] = Field(min_length=1, max_length=100)

def validate(raw):
    revision = raw.get('revision', 0) if isinstance(raw, dict) else 0
    errors = []
    def error(code, message, node=None, edge=None):
        item = dict(code=code, message=message)
        if node: item['nodeId'] = node
        if edge: item['edgeId'] = edge
        errors.append(item)
    try:
        draft = Draft.model_validate(raw)
    except ValidationError as exc:
        for item in exc.errors():
            location = '.'.join(str(key) for key in item['loc'])
            node = None
            if len(item['loc']) > 1 and item['loc'][0] == 'nodes' and isinstance(item['loc'][1], int):
                try: node = raw['nodes'][item['loc'][1]].get('id')
                except (KeyError, IndexError, TypeError): pass
            error('PYDANTIC_STRUCTURE', f"{location}: {item['msg']}", node)
        return dict(valid=False, revision=revision, engine='Pydantic 2', errors=errors, warnings=[])
    template = TEMPLATES.get(draft.templateId)
    if not template or draft.profileId not in PROFILES:
        error('UNKNOWN_CONTEXT', '未知模板或业务档案。')
        return dict(valid=False, revision=revision, engine='Pydantic 2', errors=errors, warnings=[])
    if draft.profileId not in template['profiles']:
        error('PROFILE_TEMPLATE', '该模板不适用于当前渠道或履约方式。')
    ids = [node.id for node in draft.nodes]
    if len(set(ids)) != len(ids): error('DUPLICATE_NODE', '节点 ID 必须唯一。')
    if len({edge.id for edge in draft.edges}) != len(draft.edges): error('DUPLICATE_EDGE', '连线 ID 必须唯一。')
    nodes = {node.id: node for node in draft.nodes}
    for node in draft.nodes:
        definition = DEFINITIONS.get(node.definitionId)
        if not definition:
            error('UNKNOWN_DEFINITION', '节点执行器未注册。', node.id)
            continue
        if draft.profileId not in definition['profiles']:
            error('PLATFORM_CAPABILITY', '此节点不支持当前渠道或履约方式，不能跨平台直接复用。', node.id)
        if definition['kind'] == 'ai':
            skill = SKILLS.get(node.skillId)
            if not skill or skill['input'] != definition['input'] or skill['output'] != definition['output']:
                error('SKILL_CONTRACT', 'Skill 与受信节点定义的输入输出契约不兼容。', node.id)
        elif node.skillId is not None:
            error('FIXED_HANDLER', '固定节点不能通过配置 Skill 改写其执行语义。', node.id)
    forward = [edge for edge in draft.edges if edge.kind == 'forward']
    outgoing = {node.id: [] for node in draft.nodes}
    incoming = {node.id: [] for node in draft.nodes}
    for edge in draft.edges:
        if edge.source not in nodes or edge.target not in nodes:
            error('DANGLING_EDGE', '连线引用了已删除或不存在的节点。', edge=edge.id)
        elif edge.source == edge.target:
            error('SELF_EDGE', '不支持节点连接自身。', edge=edge.id)
        elif edge.kind == 'forward':
            outgoing[edge.source].append(edge.target)
            incoming[edge.target].append(edge.source)
    starts = [key for key in ids if not incoming[key]]
    ends = [key for key in ids if not outgoing[key]]
    if len(starts) != 1 or len(ends) != 1 or any(len(v) > 1 for v in [*incoming.values(), *outgoing.values()]):
        error('GRAPH_SHAPE', '初版主执行图须为单条完整路径；协作和返工使用独立关系边。')
    order = []
    if len(starts) == 1:
        current = starts[0]
        while current not in order:
            order.append(current)
            if not outgoing[current]: break
            current = outgoing[current][0]
        if len(order) != len(nodes): error('UNREACHABLE_OR_CYCLE', '存在不可达节点或主执行环路。')
    if order and len(order) == len(nodes) and all(node.definitionId in DEFINITIONS for node in draft.nodes):
        ordered = [nodes[key] for key in order]
        if order != ids: error('DISPLAY_ORDER', '节点顺序必须与主执行路径一致，请使用移动节点自动重连。')
        if DEFINITIONS[ordered[0].definitionId]['kind'] != 'trigger': error('START_REQUIRED', '起点必须是触发器。')
        if DEFINITIONS[ordered[-1].definitionId]['kind'] != 'end': error('END_REQUIRED', '终点必须是完成节点。')
        kinds = [DEFINITIONS[node.definitionId]['kind'] for node in ordered]
        if kinds.count('trigger') != 1 or kinds.count('end') != 1: error('BOUNDARY_COUNT', '主路径只能有一个触发起点和一个完成终点。')
        present = [node.definitionId for node in ordered]
        required_positions = []
        for definition_id in template['required']:
            count = present.count(definition_id)
            if count != 1:
                error('REQUIRED_STEP', f"必经步骤「{DEFINITIONS[definition_id]['title']}」必须保留且只能出现一次。")
            else: required_positions.append(present.index(definition_id))
        if required_positions != sorted(required_positions): error('REQUIRED_ORDER', '必经规则、审批及动作顺序被改变，不能绕过原业务前置条件。')
        previous = None
        for node in ordered:
            definition = DEFINITIONS[node.definitionId]
            if definition['passthrough']:
                if previous is None: error('MISSING_CONTEXT', '扩展节点需要前序上下文。', node.id)
            else:
                if previous is not None and previous != definition['input']:
                    error('PORT_MISMATCH', f"上游输出 {previous} 不能输入 {definition['input']}；需要注册兼容适配器。", node.id)
                previous = definition['output']
        template_nodes = {node['id']: node['definitionId'] for node in template['nodes']}
        allowed_feedback = {(template_nodes[e['source']], template_nodes[e['target']]) for e in template['relations'] if e['kind'] == 'feedback'}
        for edge in draft.edges:
            if edge.source not in nodes or edge.target not in nodes or edge.kind == 'forward': continue
            source, target = nodes[edge.source], nodes[edge.target]
            a, b = DEFINITIONS[source.definitionId], DEFINITIONS[target.definitionId]
            if edge.kind == 'feedback':
                if (source.definitionId, target.definitionId) not in allowed_feedback or order.index(edge.source) <= order.index(edge.target):
                    error('UNSAFE_FEEDBACK', '返工必须使用模板声明的可重入边界，不能返回采购付款、发货或通知动作。', edge=edge.id)
            elif a['kind'] != 'ai' or not b['readOnly'] or order.index(edge.target) >= order.index(edge.source):
                error('UNSAFE_COLLABORATION', '协作须由 AI 请求上游只读证据，不能授予副作用或改变主路径。', edge=edge.id)
    return dict(valid=not errors, revision=revision, engine='Pydantic 2', errors=errors, warnings=['只验证流程定义与静态业务约束；真实执行仍需逐节点校验输入输出、账号授权及平台实时状态。'])

if __name__ == '__main__':
    try:
        raw = json.loads(sys.stdin.read(262145))
        result = validate(raw)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps(dict(valid=False, revision=0, engine='Pydantic 2', errors=[dict(code='VALIDATOR_ERROR', message=type(exc).__name__)], warnings=[])))
        sys.exit(1)
