from rest_framework import serializers
from .models import WorkflowRun
from apps.approvals.models import ApprovalRequest

class ApprovalSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalRequest
        fields = ['id', 'stage', 'generation', 'run_revision', 'digest', 'snapshot', 'status', 'expires_at']

class RunSerializer(serializers.ModelSerializer):
    approvals = ApprovalSerializer(many=True, read_only=True)
    workflow_version_id = serializers.UUIDField(source='version_id', read_only=True)
    store_id = serializers.UUIDField(read_only=True)
    document = serializers.JSONField(source='version.document', read_only=True)
    node_id = serializers.SerializerMethodField()
    attempts = serializers.SerializerMethodField()
    context = serializers.SerializerMethodField()
    release_id = serializers.SerializerMethodField()

    def get_release_id(self,obj):
        from apps.workflows.models import DesignRelease
        value=DesignRelease.objects.filter(version_id=obj.version_id,team_id=obj.team_id).values_list('id',flat=True).first()
        return str(value) if value else None

    def get_node_id(self, obj):
        return obj.version.document['nodes'][obj.cursor]['id']

    def get_attempts(self, obj):
        # Polling needs timestamps, not every historical full selection snapshot.
        return list(obj.attempts.filter(generation=obj.generation).order_by('created_at').values('id', 'node_id', 'generation', 'status', 'created_at', 'completed_at'))

    def get_context(self, obj):
        source = obj.context
        result = {key:source[key] for key in ('brief','listing','published','selection_proposal','archived_research','verification',
            'batch_mode','batch_meta','batch_briefs','batch_listings','batch_validations','batch_items','stop_requested','market_intelligence') if key in source}
        state = source.get('selection')
        if isinstance(state, dict):
            def fields(rows, names):
                return [{key:row.get(key) for key in names} for row in rows if isinstance(row,dict)]
            result['selection'] = {
                'records':fields(state.get('records',[]),('id','nameEn')),
                'facts':fields(state.get('facts',[]),('pid',)),
                'specs':[{'product':{key:row.get('product',{}).get(key) for key in ('pid','title')},
                          'variant':{'vid':row.get('variant',{}).get('vid')}} for row in state.get('specs',[])],
                'candidates':fields(state.get('candidates',[]),('pid','vid','title','status')),
                'filter_index':state.get('filter_index',0),'delivery_index':state.get('delivery_index',0)}
            if state.get('collection'):
                result['selection']['collection']={'products':fields(state['collection'].get('products',[]),('id',))}
                result['selection']['collection'].update({key:state['collection'][key] for key in ('scanned','scan_limit','quota_limit','demand_qualified','pending_index','excluded_existing') if key in state['collection']})
                result['selection']['collection']['pending']=fields(state['collection'].get('pending',[]),('id',))
            if isinstance(state.get('search'),dict):
                result['selection']['search']={key:state['search'][key] for key in
                    ('scanned','scan_limit','quota_limit','demand_qualified') if key in state['search']}
            result['selection']['product_exclusions']=state.get('product_exclusions',[])
            result['selection'].update({key:state[key] for key in ('sales_ranking','demand_metric') if key in state})
            if isinstance(state.get('current_research'),dict):
                current=state['current_research']
                result['selection']['current_research']={
                    'records':fields(current.get('records',[]),('id','nameEn')),'facts':fields(current.get('facts',[]),('pid',)),
                    'specs':[{'product':{k:(r.get('product') or {}).get(k) for k in ('pid','title')},'variant':{'vid':(r.get('variant') or {}).get('vid')}} for r in current.get('specs',[]) if isinstance(r,dict)],
                    'filter_index':current.get('filter_index',0),'delivery_index':current.get('delivery_index',0),
                    'candidates':fields(current.get('candidates',[]),('pid','vid','title','status'))}
        return result

    class Meta:
        model = WorkflowRun
        fields = ['id', 'workflow_version_id', 'release_id', 'store_id', 'document', 'status', 'cursor', 'node_id', 'revision', 'generation', 'sequence', 'context', 'error', 'created_at', 'approvals', 'attempts']

class StartSerializer(serializers.Serializer):
    version_id = serializers.UUIDField()
    store_id = serializers.UUIDField()
    idempotency_key = serializers.CharField(max_length=100, min_length=8)
    brief = serializers.JSONField(required=False, allow_null=True, default=None)

class RevisionSerializer(serializers.Serializer):
    expected_revision = serializers.IntegerField(min_value=1)

class DecisionSerializer(RevisionSerializer):
    decision = serializers.ChoiceField(choices=['approve', 'reject'])
    reason = serializers.CharField(max_length=1000, min_length=1)

class ReviseSerializer(RevisionSerializer):
    stage = serializers.ChoiceField(choices=['brief', 'listing'])
    payload = serializers.JSONField()
    reason = serializers.CharField(max_length=1000)
