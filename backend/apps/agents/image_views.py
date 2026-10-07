import io
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.common.utils import parse
from apps.identity.permissions import membership
from contracts.product_images import ImageBatchStart, ImageBatchCommand
from .models import ProductImageBatch, ProductImageAsset
from .image_service import available_products, start, command


def public_batch(batch):
    config={k:v for k,v in batch.configuration.items() if not k.endswith('fingerprint') and k!='idempotency_key'}
    return {'id':str(batch.id),'design_id':str(batch.design_id),'revision':batch.revision,
        'status':batch.status,'error':batch.error,'configuration':config,'products':batch.products,
        'plans':batch.plans,'cursor':batch.cursor,'created_at':batch.created_at.isoformat(),
        'events':batch.events,'pack':batch.pack,
        'assets':[{'id':str(a.id),'product_index':a.product_index,'shot_index':a.shot_index,
            'digest':a.digest,'width':a.width,'height':a.height,
            'url':f'/backend/v1/product-image-assets/{a.id}',
            'checks':{'file':'passed','dimensions':'passed','appearance':'requires-human-confirmation'}}
            for a in batch.assets.defer('content').order_by('product_index','shot_index')]}


class ImageProducts(APIView):
    def get(self,request):
        member=membership(request)
        # Explicit bounded catalog; no silently partial "select all".
        rows=available_products(member.team)
        return Response({'results':rows[:500],'count':len(rows),'selection_limit':500},headers={'Cache-Control':'no-store'})


class ImageBatches(APIView):
    def get(self,request):
        member=membership(request)
        from rest_framework.exceptions import ValidationError
        design=request.query_params.get('design_id','')
        if not 1<=len(design)<=100: raise ValidationError('需要明确的流程文档 ID。')
        rows=ProductImageBatch.objects.filter(team=member.team,design_id=design).order_by('-created_at')[:20]
        return Response([public_batch(b) for b in rows],headers={'Cache-Control':'no-store'})

    def post(self,request):
        member=membership(request,['operator'])
        fields=parse(ImageBatchStart,request.data)
        batch=start(member,request.user,fields)
        return Response(public_batch(batch),status=201,headers={'Cache-Control':'no-store'})


class ImageBatchDetail(APIView):
    def get(self,request,pk):
        member=membership(request)
        return Response(public_batch(get_object_or_404(ProductImageBatch,team=member.team,pk=pk)),headers={'Cache-Control':'no-store'})

    def post(self,request,pk):
        member=membership(request,['operator'])
        fields=parse(ImageBatchCommand,request.data)
        with transaction.atomic():
            batch=get_object_or_404(ProductImageBatch.objects.select_for_update(),team=member.team,pk=pk)
            command(batch,request.user,fields)
        return Response(public_batch(batch),headers={'Cache-Control':'no-store'})


class ImageAssetDetail(APIView):
    def get(self,request,pk):
        member=membership(request)
        asset=get_object_or_404(ProductImageAsset,team=member.team,pk=pk)
        response=FileResponse(io.BytesIO(bytes(asset.content)),content_type='image/png',
            as_attachment=request.query_params.get('download')=='1',filename=f'product-image-{asset.id}.png')
        response['Cache-Control']='no-store';response['X-Content-Type-Options']='nosniff'
        return response
