from django.db import models
from apps.common.models import TeamRecord

class Store(TeamRecord):
    name = models.CharField(max_length=100)
    channel = models.CharField(max_length=80, default='test-store')
    environment = models.CharField(max_length=20, default='test')
    adapter = models.CharField(max_length=80, default='test-store.v1')
    configuration_version = models.PositiveIntegerField(default=1)
    verified = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    credential_ciphertext = models.TextField(blank=True)
    capabilities = models.JSONField(default=list)


class SupplierConnection(TeamRecord):
    """Supplier credentials are separate from sales-channel Store connections."""
    provider = models.CharField(max_length=40, default='cj')
    configuration_version = models.PositiveIntegerField(default=1)
    credential_ciphertext = models.TextField()
    token_ciphertext = models.TextField(blank=True)
    token_expires_at = models.DateTimeField(null=True)
    status = models.CharField(max_length=20, default='saved')
    verified_at = models.DateTimeField(null=True)
    last_error = models.CharField(max_length=200, blank=True)
    sample_products = models.JSONField(default=list)
    verification_token = models.UUIDField(null=True)
    verification_until = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team', 'provider'], name='unique_team_supplier')]


class ModelConnection(TeamRecord):
    name = models.CharField(max_length=80)
    protocol = models.CharField(max_length=40)
    base_url = models.URLField(max_length=300)
    model_id = models.CharField(max_length=120)
    credential_ciphertext = models.TextField(blank=True)


class MappingSession(TeamRecord):
    channel = models.CharField(max_length=80)
    action = models.CharField(max_length=80)
    contract = models.JSONField()
    messages = models.JSONField(default=list)
    result = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    busy_until = models.DateTimeField(null=True)
