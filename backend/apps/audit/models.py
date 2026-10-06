from django.conf import settings
from django.db import models
from apps.common.models import ImmutableRecord

class AuditRecord(ImmutableRecord):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100)
    metadata = models.JSONField(default=dict)
