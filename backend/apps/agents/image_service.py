"""Independent, durable six-stage image batches. Never mutate publishing runs."""
import hashlib
import json
import uuid
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from apps.common.errors import RuleError, Conflict
from apps.connections.models import ModelConnection
from apps.identity.permissions import require_role
from apps.listings.models import ChannelListing, ExternalOperation
from apps.workflows.models import WorkflowDesign
from contracts.product_images import ImagePlanV2
from .models import ProductImageBatch, ProductImageAsset
from .skills import profile
from .harness import complete
from .image_transport import edit, check_generator, fingerprint, ImageResultUnknown


def available_products(team):
    publications=ChannelListing.objects.filter(team=team).select_related('run','store').order_by('-created_at','-id')
    excluded=set(ExternalOperation.objects.filter(team=team,payload__action='listing.unpublish',
        status__in=['prepared','unknown','succeeded']).values_list('run_id',flat=True))
    rows=[]
    for publication in publications:
        if publication.run_id in excluded or not publication.store.active: continue
        payload=publication.evidence.get('listing') or publication.run.context.get('listing') or publication.run.context.get('brief',{})
        if not payload.get('images'): continue
        rows.append({'id':str(publication.run_id),'title':payload.get('title',''),
            'description':payload.get('description',''),'images':payload['images'],
            'variants':[{k:v.get(k) for k in ['sku','size']} for v in payload.get('variants',[])],
            'store_id':str(publication.store_id),'store_name':publication.store.name,
            'product_id':publication.run.context.get('brief',{}).get('product_id',''),
            'publication_id':str(publication.id)})
    return rows


def connections(batch):
    config=batch.configuration
    result=[]
    for role in ['planner','generator']:
        connection=ModelConnection.objects.filter(pk=config[role+'_id'],team=batch.team).first()
        if not connection or fingerprint(connection)!=config[role+'_fingerprint']:
            raise RuleError('模型连接已改变或失效；当前批次不会静默换模型或密钥。')
        result.append(connection)
    check_generator(result[1])
    return result


def start(member,user,fields,*,frozen_document=None):
    digest=hashlib.sha256(json.dumps(fields,sort_keys=True).encode()).hexdigest()
    with transaction.atomic():
        # Serializes starts on the team without changing other workflows.
        from apps.identity.models import Team
        Team.objects.select_for_update().get(pk=member.team_id)
        existing=ProductImageBatch.objects.filter(team=member.team,idempotency_key=fields['idempotency_key']).first()
        if existing:
            if existing.request_digest!=digest: raise Conflict('请求键已用于不同的商品图配置。')
            return existing
        design=WorkflowDesign.objects.filter(team=member.team,client_id=fields['design_id']).first()
        document=frozen_document if frozen_document is not None else design.document if design else None
        expected=['image.start','image.brief','image.generate','image.check','image.authorize','image.end']
        if not document or document.get('templateId')!='product-images' or [n.get('definitionId') for n in document.get('nodes',[])]!=expected:
            raise RuleError('请先保存标准六步商品图流程；初版不执行任意修改后的图片 DAG。')
        nodes=document['nodes']; pairs={(e.get('source'),e.get('target')) for e in document.get('edges',[]) if e.get('kind')=='forward'}
        if pairs!={(nodes[i]['id'],nodes[i+1]['id']) for i in range(5)}:
            raise RuleError('商品图流程主线不匹配；不能跳过检查与确认。')
        if ProductImageBatch.objects.filter(team=member.team,design_id=fields['design_id'],
                status__in=['planning_queued','planning','plan_ready','needs_info','generating','review']).exists():
            raise Conflict('当前流程已有未结束商品图批次，请继续或停止原批次。')
        candidates={p['id']:p for p in available_products(member.team)}
        if any(pid not in candidates for pid in fields['product_ids']): raise RuleError('所选商品不再是可用的已上架商品，请刷新选择。')
        planner=ModelConnection.objects.filter(pk=fields['planner_id'],team=member.team).first()
        generator=ModelConnection.objects.filter(pk=fields['generator_id'],team=member.team).first()
        if not planner or not generator: raise RuleError('请选择本工作区已配置模型。')
        check_generator(generator)
        if planner.model_id.startswith('gpt-image-'): raise RuleError('制作方案需要对话模型，不能选择生图模型。')
        config={**fields,'planner_fingerprint':fingerprint(planner),'generator_fingerprint':fingerprint(generator),
                'generator_model_id':generator.model_id,
                'design_snapshot':document,
                'skill_digest':profile(fields['planner_skill'])['digest']}
        return ProductImageBatch.objects.create(team=member.team,requested_by=user,design_id=fields['design_id'],
            idempotency_key=fields['idempotency_key'],request_digest=digest,configuration=config,
            products=[candidates[p] for p in fields['product_ids']])


def record(batch,kind):
    batch.events=(batch.events+[{'kind':kind,'at':timezone.now().isoformat(),'cursor':batch.cursor}])[-1000:]
    batch.revision+=1


def command(batch,user,fields):
    if batch.revision!=fields['expected_revision']: raise Conflict('批次已更新，请刷新后再操作。')
    action=fields['action']
    if action=='cancel':
        if batch.status in {'delivered','cancelled'}: raise RuleError('批次已结束。')
        batch.status='stopping' if batch.lease_token else 'cancelled'
    elif action=='generate':
        if batch.status!='plan_ready' or not fields['confirmed']: raise RuleError('请先确认逐张方案及付费生图操作。')
        connections(batch)
        batch.status='generating';batch.cursor=0
    elif action=='deliver':
        if batch.status!='review' or not fields['confirmed']: raise RuleError('请完成外观、事实、使用权与用途确认后交付。')
        selected=set(fields['asset_ids']); assets=list(batch.assets.filter(id__in=selected))
        if not selected or len(assets)!=len(selected): raise RuleError('请选择本批次真实生成且检查通过的图片。')
        batch.pack={'schema_version':'ApprovedProductImagePack@1','id':str(batch.id),'version':1,
            'approved_by':user.pk,'approved_at':timezone.now().isoformat(),
            'assets':[{'id':str(a.id),'product_id':batch.products[a.product_index]['product_id'],
                'publication_id':batch.products[a.product_index]['publication_id'],'usage':batch.configuration['usage'],
                'digest':a.digest,'width':a.width,'height':a.height} for a in assets],
            'model':batch.configuration['generator_model_id'],'skill_digest':batch.configuration['skill_digest']}
        batch.status='delivered'
    record(batch,action);batch.save()


def due_batches():
    # Expired in-flight calls are NOT retried: their spend/result may be unknown.
    return ProductImageBatch.objects.filter(status__in=['planning_queued','planning','generating','stopping']).values_list('id',flat=True)[:20]


def process_batch(pk):
    token=uuid.uuid4()
    with transaction.atomic():
        batch=ProductImageBatch.objects.select_for_update().get(pk=pk)
        if batch.lease_token:
            if batch.lease_until and batch.lease_until>timezone.now(): return
            batch.status='unknown';batch.error='执行租约已过期，模型调用结果可能未知；不自动重放。'
            batch.lease_token=None;batch.lease_until=None;record(batch,'unknown');batch.save();return
        if batch.status=='stopping': batch.status='cancelled';record(batch,'cancelled');batch.save();return
        if batch.status not in {'planning_queued','planning','generating'}: return
        batch.lease_token=token;batch.lease_until=timezone.now()+timedelta(minutes=6)
        if batch.status=='planning_queued': batch.status='planning'
        record(batch,'started');batch.save()
    try:
        require_role(batch.requested_by,batch.team,['operator'])
        planner,generator=connections(batch)
        purpose=batch.configuration.get('planner_skill','product_image_batch')
        rule=profile(purpose)
        if rule['digest']!=batch.configuration['skill_digest']: raise RuleError('制作 Skill 已改变，不能替换当前批次策略。')
        if batch.status=='planning':
            product=batch.products[batch.cursor]
            message=json.dumps({'product':product,'requirements':batch.configuration['requirements'],
                'usage':batch.configuration['usage'],'image_count':batch.configuration['images_per_product']},ensure_ascii=False)
            system=rule['instructions']+'\n固定输出契约：'+json.dumps(ImagePlanV2.model_json_schema(),ensure_ascii=False)
            text,usage=complete(planner,system,[{'role':'user','content':message}],purpose=purpose)
            clean=text.strip()
            if clean.startswith('```'): clean=clean.split('\n',1)[1].rsplit('```',1)[0].strip()
            plan=ImagePlanV2.model_validate_json(clean).model_dump(mode='json')
            if len(plan['shots'])!=batch.configuration['images_per_product']: raise RuleError('方案张数不匹配，不补造方案。')
            output={'plan':plan,'usage':usage}
        else:
            count=batch.configuration['images_per_product'];p,s=divmod(batch.cursor,count)
            output=edit(generator,batch.products[p]['images'][0],batch.plans[p]['plan']['shots'][s],batch.configuration)
        # Preserve returned evidence even if authorization/configuration changed in flight.
        # Such changes block any subsequent step, not retention of an already-paid result.
        boundary_error=None
        try:
            require_role(batch.requested_by,batch.team,['operator'])
            connections(batch)
        except Exception:
            boundary_error='权限或模型连接在执行期间发生变化；结果已保存，不继续下一步。'
        with transaction.atomic():
            current=ProductImageBatch.objects.select_for_update().get(pk=pk)
            if current.lease_token!=token: return
            if batch.status=='planning':
                current.plans.append(output);current.cursor+=1
                if output['plan']['questions']:
                    current.status='needs_info'
                elif current.cursor==len(current.products):
                    current.status='plan_ready'
            else:
                content,width,height,request_id,usage=output
                ProductImageAsset.objects.create(team=batch.team,batch=current,product_index=p,shot_index=s,
                    content=content,digest=hashlib.sha256(content).hexdigest(),width=width,height=height,
                    provider_request_id=request_id,usage=usage)
                current.cursor+=1
                if current.cursor==len(current.products)*count: current.status='review'
            # A cancellation made during a remote call is applied after its result is retained.
            if ProductImageBatch.objects.filter(pk=pk,status='stopping').exists(): current.status='cancelled'
            elif boundary_error: current.status='failed';current.error=boundary_error
            current.lease_token=None;current.lease_until=None;record(current,'completed_step');current.save()
    except Exception as exc:
        from pydantic import ValidationError
        if isinstance(exc,ImageResultUnknown): state='unknown';message=str(exc.detail)
        elif isinstance(exc,RuleError): state='failed';message=str(exc.detail)
        elif isinstance(exc,ValidationError): state='failed';message='方案未通过固定契约；不会补齐或继续生图。'
        else: state='unknown';message='执行未能保存可核验结果；不自动重试，请检查服务端。'
        with transaction.atomic():
            current=ProductImageBatch.objects.select_for_update().get(pk=pk)
            if current.lease_token==token:
                current.status=state;current.error=message[:500];current.lease_token=None;current.lease_until=None
                record(current,state);current.save()
