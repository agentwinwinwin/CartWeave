"""Keep one resumable research round; never prune approval or publication evidence."""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import WorkflowRun, SelectionTask


@transaction.atomic
def prune_run_history(team, actor):
    """Keep current + previous root run; discard obsolete execution/research data.

    Tiny run identities are retained for idempotency. Publication/approval records
    remain authoritative; live jobs and uncertain external writes are never pruned.
    """
    from .models import NodeAttempt, RunEvent, Outbox, WaitCondition
    from .services import audit
    type(team).objects.select_for_update().get(pk=team.pk)
    roots=list(WorkflowRun.objects.select_for_update().filter(team=team,
        context__batch_parent__isnull=True).filter(Q(context__history_pruned__isnull=True)|Q(context__history_pruned=False)).order_by('-created_at','-id'))
    result={'pruned':0,'protected':0,'kept':[str(r.id) for r in roots[:2]]}
    for root in roots[2:]:
        family=[root,*WorkflowRun.objects.select_for_update().filter(team=team,context__batch_parent=str(root.id))]
        ids=[r.id for r in family]
        if any(r.status not in ('succeeded','cancelled','needs_attention','waiting_approval') for r in family) or (
            Outbox.objects.filter(run_id__in=ids,status__in=['pending','claimed']).exists() or
            any(r.operations.exclude(status='succeeded').exists() for r in family)):
            result['protected']+=1
            continue
        for run in family:
            context=run.context
            if run.status=='waiting_approval':
                run.approvals.filter(status='pending').update(status='superseded')
                run.status='cancelled'
            task_id=context.get('selection_task')
            if task_id:
                SelectionTask.objects.filter(pk=task_id,team=team).exclude(status__in=['queued','running','workflow_owned']).update(
                    candidates=[],log=[],evidence={'workflow_run':str(root.id),'history_pruned':True})
            # Product projection and immutable approvals/receipts still need these.
            run.context={k:v for k,v in context.items() if k in (
                'brief','listing','published','receipt','batch_parent','batch_mode','batch_member','reviewWaivers')}
            run.context.update(history_pruned=True,archived_research={
                'archived_at':timezone.now().isoformat(),'reason':'仅保留当前及上一次运行；旧研究与执行日志已清理'})
            run.save(update_fields=['context','status'])
            NodeAttempt.objects.filter(run=run).delete()
            RunEvent.objects.filter(run=run).delete()
            Outbox.objects.filter(run=run).delete()
            WaitCondition.objects.filter(run=run).delete()
            audit(run,'run.history_pruned',actor,{'retained':'idempotency, approvals and publication evidence'})
        result['pruned']+=1
    return result


@transaction.atomic
def archive_old_research(keep, actor):
    from .services import audit
    type(keep.team).objects.select_for_update().get(pk=keep.team_id)
    count = 0
    runs = WorkflowRun.objects.select_for_update().filter(
        team=keep.team, created_at__lt=keep.created_at,
        status__in=['needs_attention', 'cancelled']).order_by('created_at')
    for run in runs:
        context = run.context
        if (not context.get('selection_task') or context.get('archived_research')
                or context.get('brief') or context.get('reviewWaivers')
                or run.approvals.exists() or run.listings.exists()
                or run.operations.exists() or hasattr(run, 'publication')):
            continue
        state = context.get('selection', {})
        summary = {'archived_at': timezone.now().isoformat(),
                   'checked': state.get('filter_index', 0),
                   'total': len(state.get('specs', [])), 'reason': run.error[:500]}
        run.context = {'query': context.get('query', {}),
                       'selection_task': context['selection_task'], 'archived_research': summary}
        run.save(update_fields=['context'])
        run.attempts.update(output={})
        SelectionTask.objects.filter(pk=context['selection_task'], team=keep.team,
            status__in=['needs_attention', 'cancelled']).update(
                evidence={'workflow_run': str(run.id), 'archived_research': summary}, candidates=[], log=[])
        audit(run, 'research.archived', actor, summary)
        count += 1
    return count


def progress_output(result):
    """The latest run.context owns facts; incremental attempts only need counters."""
    state = result.get('selection', {})
    return {'progress': {'filter_index': state.get('filter_index', 0),
        'demand_checked':state.get('collection',{}).get('scanned',0),
        'demand_scan_limit':state.get('collection',{}).get('scan_limit',0),
        'delivery_index': state.get('delivery_index', 0),
        'records': len(state.get('records', [])), 'specs': len(state.get('specs', [])),
        'eligible': len(state.get('candidates', [])), 'rejected': len(state.get('rejected', []))}}
