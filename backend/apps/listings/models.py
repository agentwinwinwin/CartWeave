from django.db import models
from apps.common.models import ImmutableRecord, TeamRecord

class ListingRevision(ImmutableRecord):
    run = models.ForeignKey('runtime.WorkflowRun', on_delete=models.PROTECT, related_name='listings')
    generation = models.PositiveIntegerField()
    digest = models.CharField(max_length=64)
    payload = models.JSONField()

class ExternalOperation(TeamRecord):
    run = models.ForeignKey('runtime.WorkflowRun', on_delete=models.PROTECT, related_name='operations')
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    key = models.CharField(max_length=100)
    request_digest = models.CharField(max_length=64)
    payload = models.JSONField()
    status = models.CharField(max_length=20, default='prepared')
    receipt = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['store', 'key'], name='unique_external_key')]

class ChannelListing(TeamRecord):
    run = models.OneToOneField('runtime.WorkflowRun', on_delete=models.PROTECT, related_name='publication')
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    external_id = models.CharField(max_length=100)
    evidence = models.JSONField()
