"""Store-scoped CJ deduplication from durable publication evidence, not titles."""
from django.db.models import Exists, OuterRef, Q
from .models import WorkflowRun
from apps.listings.models import ChannelListing, ExternalOperation


def cj_pids(brief):
    if not isinstance(brief,dict) or brief.get('source_kind')!='cj_selection':return set()
    return {v['cj_pid'] for v in brief.get('variants',[]) if isinstance(v,dict)
        and isinstance(v.get('cj_pid'),str) and v['cj_pid']}


def blocked_pids(team, store_id, exclude_run=None):
    runs=WorkflowRun.objects.filter(team=team,store_id=store_id,context__brief__source_kind='cj_selection')
    if exclude_run:runs=runs.exclude(pk=exclude_run)
    runs=runs.annotate(
        published=Exists(ChannelListing.objects.filter(team=team,store_id=store_id,run_id=OuterRef('pk'))),
        deactivated=Exists(ExternalOperation.objects.filter(team=team,store_id=store_id,run_id=OuterRef('pk'),
            payload__action='listing.unpublish',status='succeeded')),
        submitting=Exists(ExternalOperation.objects.filter(team=team,store_id=store_id,run_id=OuterRef('pk'),
            status__in=['prepared','unknown','succeeded']).filter(
                Q(payload__action__isnull=True)|~Q(payload__action='listing.unpublish'))),
    ).filter(Q(published=True)|Q(submitting=True)).filter(deactivated=False)
    result=set()
    for brief in runs.values_list('context__brief',flat=True):result.update(cj_pids(brief))
    return result


def task_blocked_pids(task):
    reference=getattr(task,'evidence',{}).get('workflow_run')
    if not reference:return set()  # Independent supplier research has no target store.
    run=WorkflowRun.objects.get(pk=reference,team=task.team)
    return blocked_pids(task.team,run.store_id,run.id)
