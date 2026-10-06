from django.conf import settings
from django.db import models
from apps.common.models import TeamRecord, ImmutableRecord

class ApprovalRequest(TeamRecord):
    run = models.ForeignKey('runtime.WorkflowRun', on_delete=models.PROTECT, related_name='approvals')
    stage = models.CharField(max_length=20)
    generation = models.PositiveIntegerField()
    run_revision = models.PositiveIntegerField()
    digest = models.CharField(max_length=64)
    snapshot = models.JSONField()
    status = models.CharField(max_length=20, default='pending')
    expires_at = models.DateTimeField()

class ApprovalDecision(ImmutableRecord):
    request = models.OneToOneField(ApprovalRequest, on_delete=models.PROTECT, related_name='decision')
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    decision = models.CharField(max_length=20)
    reason = models.CharField(max_length=1000)
