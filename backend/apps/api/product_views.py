"""Read-only projection of real publication tasks; no second product database."""
from django.db.models import Case, When, Value, CharField, Count, Exists, OuterRef, Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.identity.permissions import membership
from apps.runtime.models import WorkflowRun
from apps.listings.models import ChannelListing, ExternalOperation
from apps.connections.models import Store


class Products(APIView):
    def get(self, request):
        member = membership(request)
        try:
            page = int(request.query_params.get('page', 1))
            if page < 1 or page > 100000:
                raise ValueError()
        except ValueError:
            raise ValidationError('page 必须为正整数。')
        state = request.query_params.get('status', '')
        if state not in ('', 'draft', 'review', 'publishing', 'submitted', 'published', 'attention', 'cancelled', 'inactive', 'unpublish_pending'):
            raise ValidationError('未知商品状态。')
        view = request.query_params.get('view', 'all')
        if view not in ('all', 'active', 'archived'):
            raise ValidationError('未知商品视图。')
        if view == 'active' and state == 'inactive' or view == 'archived' and state not in ('', 'inactive'):
            raise ValidationError('商品状态与视图不匹配。')
        query = request.query_params.get('q', '').strip()
        if len(query) > 200:
            raise ValidationError('搜索内容最多 200 字。')
        runs = WorkflowRun.objects.filter(team=member.team, context__brief__product_id__isnull=False).filter(Q(context__batch_mode__isnull=True)|~Q(context__batch_mode='parent')).annotate(
            has_publication=Exists(ChannelListing.objects.filter(run_id=OuterRef('pk'), team=member.team)),
            unpublished=Exists(ExternalOperation.objects.filter(run_id=OuterRef('pk'), team=member.team, payload__action='listing.unpublish', status='succeeded')),
            unpublish_pending=Exists(ExternalOperation.objects.filter(run_id=OuterRef('pk'), team=member.team, payload__action='listing.unpublish', status__in=['prepared','unknown'])),
        ).annotate(product_status=Case(
            When(unpublished=True, then=Value('inactive')),
            When(unpublish_pending=True, then=Value('unpublish_pending')),
            When(has_publication=True, then=Value('published')),
            When(status__in=['needs_attention', 'succeeded'], then=Value('attention')),
            When(status='cancelled', then=Value('cancelled')),
            When(status='waiting_approval', then=Value('review')),
            When(context__receipt__isnull=False, then=Value('submitted')),
            When(context__listing__isnull=False, then=Value('publishing')),
            default=Value('draft'), output_field=CharField(),
        ))
        stats = {item['product_status']: item['total'] for item in runs.values('product_status').annotate(total=Count('id'))}
        total = sum(stats.values())
        # Confirmed deactivation only: unknown results stay visible for reconciliation.
        if view == 'active':
            runs = runs.exclude(product_status='inactive')
        elif view == 'archived':
            runs = runs.filter(product_status='inactive')
        if state:
            runs = runs.filter(product_status=state)
        if query:
            runs = runs.filter(Q(context__brief__title__icontains=query) | Q(context__listing__title__icontains=query) | Q(context__brief__product_id__icontains=query))
        channel = request.query_params.get('channel', '')
        if channel:
            runs = runs.filter(store__channel=channel)
        count = runs.count()
        rows = []
        for run in runs.select_related('store', 'publication').order_by('-created_at', '-id')[(page-1)*50:page*50]:
            brief = run.context['brief']
            publication = getattr(run, 'publication', None)
            payload = publication.evidence.get('listing', {}) if publication else run.context.get('listing', {})
            payload = payload or brief
            variants = payload.get('variants', [])
            rows.append({
                'id': str(run.id), 'product_id': brief['product_id'], 'title': payload.get('title', brief['title']),
                'status': run.product_status, 'run_status': run.status, 'source_kind': brief['source_kind'],
                'store': {'id':str(run.store_id), 'name':run.store.name, 'channel':run.store.channel, 'adapter':run.store.adapter},
                'currency':payload['currency'], 'market':payload['market'],
                'variants': [{'sku':v['sku'], 'size':v['size'], 'price':str(v['price']), 'quantity':v['inventory']} for v in variants],
                'images':payload.get('images', []), 'created_at':run.created_at.isoformat(),
                'confirmed_at':publication.created_at.isoformat() if publication else None,
                'publication_digest':publication.evidence.get('digest') if publication else None,
                'store_version':run.store.configuration_version,
                'can_unpublish':bool(publication and member.role in ('admin','approver') and run.store.active and run.store.verified and run.store.adapter=='test-store.v1' and {'listing.unpublish','listing.status'}<=set(run.store.capabilities)),
            })
        return Response({'results':rows, 'count':count, 'page':page, 'page_size':50,
            'stats':{'total':total, **stats},
            'channels':list(Store.objects.filter(team=member.team).values_list('channel', flat=True).distinct()),
            'can_verify_stores':member.role=='admin',
            'scope':'publication-tasks', 'inventory_mode':'publication-snapshot'}, headers={'Cache-Control':'no-store'})


class ProductUnpublish(APIView):
    def post(self, request, pk):
        from apps.common.utils import parse
        from apps.listings.unpublish import ConfirmUnpublish, unpublish
        member = membership(request, ['approver'])
        command = parse(ConfirmUnpublish, request.data)
        status = unpublish(member, request.user, pk, command)
        return Response({'status':status}, status=202 if status=='unknown' else 200)
