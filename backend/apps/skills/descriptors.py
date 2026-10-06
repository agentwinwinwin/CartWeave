def skill_descriptor(skill):
    """Server-owned design metadata; never inferred from user-supplied manifests."""
    if skill.handler=='product.opportunity.v5':
        return {'id':f'registered.{skill.id}','name':'CJ 订单与刊登关注度选品','version':skill.version,'runtime':'script',
            'description':'订单45%、刊登关注度25%、成本15%、时效10%、库存5%。刊登分递增饱和，不代表销量或独立商家数；缺刊登记录不猜值。',
            'input':'DeliveryCandidates@1','output':'SelectionProposal@1','entrypointRef':f'registered://{skill.id}',
            'parameterSchema':{},'capabilities':[],'effects':['read'],'channels':['*']}
    if skill.handler=='product.opportunity.v4':
        return {'id':f'registered.{skill.id}','name':'CJ 订单需求与供货选品','version':skill.version,'runtime':'script',
            'description':'读取 CJ 商品 orderCount 订单数（周期及国家未声明，非近90天卖出件数），需求45%、成本35%、时效15%、库存5%。缺订单数据暂停，两轮核验。',
            'input':'DeliveryCandidates@1','output':'SelectionProposal@1','entrypointRef':f'registered://{skill.id}',
            'parameterSchema':{},'capabilities':[],'effects':['read'],'channels':['*']}
    if skill.handler=='product.opportunity.v3':
        return {'id':f'registered.{skill.id}','name':'CJ 销量与供货选品','version':skill.version,'runtime':'script',
            'description':'自动读取 CJ 商品详情的近 90 天销量，结合到货成本、时效与库存排序。无需上传证据；缺销量暂停，不伪造目标国家趋势。',
            'input':'DeliveryCandidates@1','output':'SelectionProposal@1','entrypointRef':f'registered://{skill.id}',
            'parameterSchema':{},'capabilities':[],'effects':['read'],'channels':['*']}
    if skill.handler=='product.opportunity.v2':
        return {'id':f'registered.{skill.id}','name':'销量趋势与竞争选品','version':skill.version,'runtime':'script',
            'description':'读取两个 30 天窗口的销量/搜索、竞品价格、竞争数量及获客成本，确定性评分并建议含广告售价；无证据停止。',
            'input':'DeliveryCandidates@1','output':'SelectionProposal@1','entrypointRef':f'registered://{skill.id}',
            'parameterSchema':{'marketEvidenceRef':{'type':'string','label':'市场证据版本','required':True},
                'allowEstimatedSales':{'type':'boolean','label':'允许明确标注的估算销量（仍强制人工审核）','default':False}},
            'capabilities':[],'effects':['read'],'channels':['*']}
    if skill.handler=='product.opportunity.v1':
        return {'id':f'registered.{skill.id}','name':'商品机会与售价建议','version':skill.version,'runtime':'script',
            'description':'历史供货评分，不读取销量。成本 60% + 总时效 25% + 库存缓冲 15%，工厂供货扣 10 分；需要销量、趋势与竞争请选择 2.0.0。',
            'input':'DeliveryCandidates@1','output':'SelectionProposal@1','entrypointRef':f'registered://{skill.id}',
            'parameterSchema':{},'capabilities':[],'effects':['read'],'channels':['*']}
    if skill.handler != 'content.editorial.v1':
        return None
    return {
        'id': f'registered.{skill.id}', 'name': '原素材与商品文案整理',
        'version': skill.version, 'runtime': 'script',
        'description': '沿用已确认的商品资料、图片与文案，不调用模型。可用于七步测试站发布或十五步 CJ 到测试站主线。',
        'input': 'ApprovedProductBrief@2', 'output': 'ListingDraft@1',
        'entrypointRef': f'registered://{skill.id}',
        'parameterSchema': {}, 'capabilities': [], 'effects': ['read', 'artifact'],
        'channels': ['*'],
    }
