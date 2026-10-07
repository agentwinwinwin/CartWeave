"""Server-owned phase-one graph. Unsupported frontend nodes fail closed."""
NODES = [
    {'id': 'product.authorize', 'title': '确认商品、规格与售价', 'mode': 'parameters', 'input': 'ProductBrief@1', 'output': 'ApprovedProductBrief@2'},
    {'id': 'content.make', 'title': '制作商品内容与素材', 'mode': 'skill', 'input': 'ApprovedProductBrief@2', 'output': 'ListingDraft@1'},
    {'id': 'listing.validate', 'title': '检查内容与渠道要求', 'mode': 'adapter', 'input': 'ListingDraft@1', 'output': 'ValidatedListing@1'},
    {'id': 'listing.authorize', 'title': '审核最终上架草稿', 'mode': 'parameters', 'input': 'ValidatedListing@1', 'output': 'ApprovedListing@1'},
    {'id': 'listing.publish', 'title': '提交渠道发布', 'mode': 'adapter', 'input': 'ApprovedListing@1', 'output': 'PublicationReceipt@1'},
    {'id': 'listing.wait', 'title': '等待真实可售结果', 'mode': 'adapter', 'input': 'PublicationReceipt@1', 'output': 'PublishedProduct@1'},
    {'id': 'listing.end', 'title': '交付可售商品', 'mode': 'fixed', 'input': 'PublishedProduct@1', 'output': 'PublishedProduct@1'},
]
NODE_IDS = [n['id'] for n in NODES]

def template(skill):
    return {'schemaVersion': '2', 'id': 'phase-one-launch', 'title': '审批后发布到测试站', 'revision': 1,
        'templateId': 'launch-test', 'environment': {'channel': 'test-store', 'fulfillment': 'supplier', 'capabilities': []},
        'nodes': [{'id': key, 'definitionId': key, 'title': next(n['title'] for n in NODES if n['id'] == key),
            'binding': {'skillId': skill.key if key == 'content.make' else 'system.' + key,
                'skillVersion': skill.version if key == 'content.make' else '1', 'mode': 'default', 'parameters': {}}} for key in NODE_IDS],
        'edges': [{'id': f'{a}:{b}', 'source': a, 'target': b, 'kind': 'forward'} for a, b in zip(NODE_IDS, NODE_IDS[1:])], 'customSkills': []}

def validate_document(document, skill, *, frozen=False):
    from apps.common.errors import RuleError
    from .business import is_business, validate
    if is_business(document):
        if skill is not None:
            raise RuleError('模型业务不能绑定选品或内容整理执行器，请使用业务流程的冻结入口。')
        return validate(document, frozen=frozen)
    if skill is None:
        raise RuleError('发布图必须绑定受信注册 Skill，不能使用模型业务的空执行器。')
    from .launch import is_launch, validate_launch
    if is_launch(document):
        return validate_launch(document, skill, frozen=frozen)
    from apps.common.errors import RuleError
    from apps.skills.handlers import check_skill
    from apps.common.utils import parse
    from contracts.workflows import Document
    document = parse(Document, document)
    check_skill(skill)
    if document.get('schemaVersion') != '2' or document.get('customSkills') or document.get('customChannels'):
        raise RuleError('第一阶段不执行自建清单或未注册渠道。')
    environment = document.get('environment', {})
    if environment.get('channel') != 'test-store' or environment.get('fulfillment') != 'supplier':
        raise RuleError('请选择测试站及供应商履约设计；本阶段不执行采购。')
    nodes = document.get('nodes', [])
    if [n.get('definitionId') for n in nodes] != NODE_IDS or len({n.get('id') for n in nodes}) != len(NODE_IDS):
        raise RuleError('第一阶段仅运行已注册的七步发布主线，不允许删除审批或增加未实现节点。')
    expected = [(a['id'], b['id']) for a, b in zip(nodes, nodes[1:])]
    edges = document.get('edges', [])
    if len(edges) != len(expected) or [(e.get('source'), e.get('target')) for e in edges] != expected or any(e.get('kind') != 'forward' for e in edges) or len({e.get('id') for e in edges}) != len(expected):
        raise RuleError('执行图必须匹配已注册主线；返工通过受控修订接口完成。')
    for node in nodes:
        binding = node.get('binding', {})
        expected_id = skill.key if node['definitionId'] == 'content.make' else 'system.' + node['definitionId']
        version = skill.version if node['definitionId'] == 'content.make' else '1'
        if binding.get('skillId') != expected_id or binding.get('skillVersion') != version:
            raise RuleError('不能替换固定实现、审批职责或未审核 Skill。')
        parameters = binding.get('parameters', {})
        if node['definitionId'] in ('product.authorize', 'listing.authorize'):
            from django.conf import settings
            if set(parameters) - {'approvalEnabled'} or ('approvalEnabled' in parameters and type(parameters['approvalEnabled']) is not bool):
                raise RuleError('人工审核开关必须为布尔值，不能覆盖其他规则。')
            if parameters.get('approvalEnabled', True) is False and not (settings.LOCAL and settings.DESKTOP_MODE):
                raise RuleError('关闭人工审核仅适用于私人本机测试站。')
        elif parameters:
            raise RuleError('此系统节点不接受参数覆盖。')
        if binding.get('connectionRef') or binding.get('execution'):
            raise RuleError('第一阶段没有开放节点参数覆盖，店铺连接由运行请求绑定。')
    return document
