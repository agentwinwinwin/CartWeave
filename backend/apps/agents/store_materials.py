"""Export confirmed assets without changing original publication evidence."""
import base64
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.common.errors import RuleError
from apps.common.utils import digest
from apps.identity.permissions import membership
from apps.listings.models import ChannelListing
from apps.teststore.testing import adapter_for, call
from .models import ProductImageBatch

class MaterialExport(APIView):
    def post(self,request,pk):
        member=membership(request,['operator'])
        if request.data!={'confirmed':True}: raise RuleError('请确认只归档测试站素材，不修改线上图片。')
        batch=get_object_or_404(ProductImageBatch,pk=pk,team=member.team,status='delivered')
        results=[]
        for approved in batch.pack.get('assets',[]):
            asset=get_object_or_404(batch.assets,id=approved['id'],digest=approved['digest'])
            publication=get_object_or_404(ChannelListing,id=approved['publication_id'],team=member.team)
            store,adapter=adapter_for(member,publication.store_id)
            key=digest({'batch':str(batch.id),'asset':str(asset.id),'digest':asset.digest,'store_version':store.configuration_version})
            # Always check original key first; retry only an explicitly absent result.
            existing=adapter.call('POST','/testing/actions/materials.lookup',{'operation_key':key},allow_missing=True)
            if existing:
                from contracts.store_testing import envelope
                from apps.common.utils import parse
                value=parse(envelope('materials.lookup'),existing)
                if value['storefront_id']!=str(store.id): raise RuleError('素材回执不属于当前店铺。')
                result=value['result']
            else:
                result=call(adapter,'materials.save',{'operation_key':key,'product_id':publication.external_id,
                    'batch_id':str(batch.id),'asset_id':str(asset.id),'png_base64':base64.b64encode(bytes(asset.content)).decode(),
                    'sha256':asset.digest,'appearance_confirmed':True})
            if result.get('sha256')!=asset.digest or result.get('product_id')!=publication.external_id:
                raise RuleError('素材归档回执不匹配，未标记完成。')
            results.append(result)
        if not results: raise RuleError('素材包没有已确认的图片。')
        return Response({'status':'archived-not-published','receipts':results})
