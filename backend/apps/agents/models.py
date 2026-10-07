from django.db import models
from apps.common.models import TeamRecord


class OperationReport(TeamRecord):
    """Append-only result archive; never a workflow execution authorization."""
    kind = models.CharField(max_length=20, db_index=True)
    requested_by = models.ForeignKey('auth.User', on_delete=models.PROTECT)
    request_key = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    payload = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team','request_key'], name='unique_operation_report_key')]


class AgentSession(TeamRecord):
    purpose=models.CharField(max_length=40)
    skill_digest=models.CharField(max_length=64)
    messages=models.JSONField(default=list)
    result=models.JSONField(default=dict)
    revision=models.PositiveIntegerField(default=1)
    busy_until=models.DateTimeField(null=True)


class ProductImageBatch(TeamRecord):
    design_id = models.CharField(max_length=100, db_index=True)
    requested_by = models.ForeignKey('auth.User', on_delete=models.PROTECT)
    idempotency_key = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    configuration = models.JSONField()
    products = models.JSONField()
    plans = models.JSONField(default=list)
    cursor = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=30, default='planning_queued', db_index=True)
    revision = models.PositiveIntegerField(default=1)
    error = models.CharField(max_length=500, blank=True)
    lease_until = models.DateTimeField(null=True)
    lease_token = models.UUIDField(null=True)
    events = models.JSONField(default=list)
    pack = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team','idempotency_key'], name='unique_image_batch_key')]


class ProductImageAsset(TeamRecord):
    batch = models.ForeignKey(ProductImageBatch, on_delete=models.PROTECT, related_name='assets')
    product_index = models.PositiveIntegerField()
    shot_index = models.PositiveIntegerField()
    content = models.BinaryField()
    digest = models.CharField(max_length=64)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    provider_request_id = models.CharField(max_length=120, blank=True)
    usage = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['batch','product_index','shot_index'], name='unique_image_shot')]
