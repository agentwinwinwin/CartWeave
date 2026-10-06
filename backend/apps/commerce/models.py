from django.db import models
from apps.common.models import TeamRecord


class BusinessRecord(TeamRecord):
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    kind = models.CharField(max_length=20)
    external_id = models.CharField(max_length=160)
    revision = models.PositiveIntegerField()
    payload = models.JSONField()
    observed_at = models.DateTimeField()

    class Meta:
        constraints=[models.UniqueConstraint(fields=['store','kind','external_id'],name='commerce_store_record')]


class SyncState(TeamRecord):
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    kind = models.CharField(max_length=20)
    cursor = models.CharField(max_length=200,default='0')
    store_version = models.PositiveIntegerField()
    has_more = models.BooleanField(default=False)
    synced_at = models.DateTimeField(null=True)
    lease_until = models.DateTimeField(null=True)

    class Meta:
        constraints=[models.UniqueConstraint(fields=['store','kind'],name='commerce_sync_state')]
