"""One operator verification node, with durable internal checks and replenishment."""
from copy import copy,deepcopy
from .batch import enabled,research
from .launch import execute_node

PHASES=('product.normalize','product.filter','product.delivery')
LABELS={'product.normalize':'商品资料','product.filter':'规格与库存','product.delivery':'配送与到货成本'}

def verify(run):
    from apps.registry.launch import is_compact
    phases=(*PHASES,'product.decide','product.cost') if is_compact(run.version.document) else PHASES
    state=deepcopy(run.context.get('verification',{'phase':PHASES[0],'completed':[]}))
    local=copy(run);local.context=deepcopy(run.context)
    outputs={}
    batched=enabled(run)
    for _ in phases:
        phase=state['phase']
        result=research(local,phase) if batched else execute_node(local,phase)
        state['label']={**LABELS,'product.decide':'商品排序与售价建议','product.cost':'系统独立复核售价'}[phase]
        if result.get('_goto')==1:
            state.update(phase=PHASES[0],completed=[])
            return {**outputs,**result,'verification':state}
        if result.get('_goto')==2:
            result.pop('_goto')
            state.update(phase=PHASES[0],completed=[])
            return {**outputs,**result,'verification':state,'_continue':True}
        if result.get('_continue') or result.get('_research_required'):
            return {**outputs,**result,'verification':state}
        state['completed']=list(dict.fromkeys([*state.get('completed',[]),phase]))
        local.context.update(result)
        outputs.update(result)
        if phase==phases[-1]:
            state.update(phase='done',label='统一核验与定价完成')
            return {**outputs,'verification':state}
        state['phase']=phases[phases.index(phase)+1]
    raise RuntimeError('Invalid unified verification state')
