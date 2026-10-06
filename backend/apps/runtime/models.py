from django.conf import settings
from django.db import models
from apps.common.models import TeamRecord, ImmutableRecord, Record

class WorkflowRun(TeamRecord):
    version = models.ForeignKey('workflows.WorkflowVersion', on_delete=models.PROTECT)
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    store_version = models.PositiveIntegerField()
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    idempotency_key = models.CharField(max_length=100)
    request_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=30, default='queued')
    cursor = models.PositiveIntegerField(default=0)
    revision = models.PositiveIntegerField(default=1)
    generation = models.PositiveIntegerField(default=1)
    sequence = models.PositiveIntegerField(default=0)
    context = models.JSONField(default=dict)
    error = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team', 'idempotency_key'], name='unique_run_key')]

class NodeAttempt(TeamRecord):
    run = models.ForeignKey(WorkflowRun, on_delete=models.PROTECT, related_name='attempts')
    node_id = models.CharField(max_length=100)
    generation = models.PositiveIntegerField()
    status = models.CharField(max_length=30, default='running')
    input_digest = models.CharField(max_length=64)
    output = models.JSONField(default=dict)
    completed_at = models.DateTimeField(null=True)

class RunEvent(ImmutableRecord):
    run = models.ForeignKey(WorkflowRun, on_delete=models.PROTECT, related_name='events')
    sequence = models.PositiveIntegerField()
    payload = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['run', 'sequence'], name='unique_event_sequence')]

class WaitCondition(TeamRecord):
    run = models.ForeignKey(WorkflowRun, on_delete=models.PROTECT, related_name='waits')
    kind = models.CharField(max_length=30)
    generation = models.PositiveIntegerField()
    resolved = models.BooleanField(default=False)

class Outbox(Record):
    run = models.ForeignKey(WorkflowRun, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, default='pending')
    available_at = models.DateTimeField()
    lease_until = models.DateTimeField(null=True)
    lease_token = models.UUIDField(null=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.CharField(max_length=200, blank=True)

class SelectionTask(TeamRecord):
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    query = models.JSONField()
    connection_version = models.PositiveIntegerField()
    status = models.CharField(max_length=30, default='queued')
    stage = models.CharField(max_length=30, default='collect')
    evidence = models.JSONField(default=dict)
    candidates = models.JSONField(default=list)
    log = models.JSONField(default=list)
    error = models.CharField(max_length=500, blank=True)
    lease_until = models.DateTimeField(null=True)
    lease_token = models.UUIDField(null=True)
    completed_at = models.DateTimeField(null=True)


class WorkflowSchedule(TeamRecord):
    name = models.CharField(max_length=120)
    release = models.ForeignKey('workflows.DesignRelease', on_delete=models.PROTECT)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    frequency = models.CharField(max_length=20)
    timezone = models.CharField(max_length=100)
    clock = models.CharField(max_length=5, default='09:00')
    weekdays = models.JSONField(default=list)
    interval_hours = models.PositiveIntegerField(default=24)
    enabled = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=1)
    next_due_at = models.DateTimeField(null=True, db_index=True)
    last_run = models.ForeignKey(WorkflowRun, null=True, on_delete=models.PROTECT)
    last_error = models.CharField(max_length=500, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class ScheduleOccurrence(TeamRecord):
    schedule = models.ForeignKey(WorkflowSchedule, on_delete=models.PROTECT, related_name='occurrences')
    scheduled_at = models.DateTimeField()
    status = models.CharField(max_length=20)
    reason = models.CharField(max_length=500, blank=True)
    run = models.ForeignKey(WorkflowRun, null=True, on_delete=models.PROTECT)
    schedule_revision = models.PositiveIntegerField()
    release = models.ForeignKey('workflows.DesignRelease', on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['schedule', 'scheduled_at'], name='unique_schedule_occurrence')]


class SchedulerHeartbeat(models.Model):
    name = models.CharField(max_length=20, primary_key=True)
    last_seen_at = models.DateTimeField()
