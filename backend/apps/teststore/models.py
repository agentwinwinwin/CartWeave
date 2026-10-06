from django.db import models
from apps.common.models import Record

class ApiClient(Record):
    """Independent storefront identity; never grants workflow membership."""
    name = models.CharField(max_length=100)
    token_hash = models.CharField(max_length=64, unique=True)
    active = models.BooleanField(default=True)
    storefront_id = models.UUIDField(unique=True)

class PublishedProduct(Record):
    client = models.ForeignKey(ApiClient, on_delete=models.PROTECT)
    product_id = models.CharField(max_length=100)
    operation_key = models.CharField(max_length=100)
    digest = models.CharField(max_length=64)
    payload = models.JSONField()
    status = models.CharField(max_length=20, default='active')
    unpublish_key = models.CharField(max_length=64, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['client', 'operation_key'], name='unique_store_operation'),
                       models.UniqueConstraint(fields=['client', 'product_id'], name='unique_store_product')]
        constraints += [models.UniqueConstraint(fields=['client', 'unpublish_key'], name='unique_store_unpublish')]


class BusinessEvent(models.Model):
    """Private append-only export source; demo checkout does not write these facts."""
    sequence = models.BigAutoField(primary_key=True)
    client = models.ForeignKey(ApiClient,on_delete=models.PROTECT)
    kind = models.CharField(max_length=20)
    external_id = models.CharField(max_length=160)
    revision = models.PositiveIntegerField()
    payload = models.JSONField()

    class Meta:
        constraints=[models.UniqueConstraint(fields=['client','kind','external_id','revision'],name='store_business_event')]

    def save(self,*args,**kwargs):
        if not self._state.adding:raise ValueError('Create a new fact revision, do not overwrite exports.')
        super().save(*args,**kwargs)
