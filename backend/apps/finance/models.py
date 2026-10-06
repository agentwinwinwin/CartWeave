from django.db import models
from apps.common.models import ImmutableRecord


class OrderFinancialFact(ImmutableRecord):
    """Versioned actual order facts; estimates and demo orders do not belong here."""
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    external_order_id = models.CharField(max_length=160)
    revision = models.PositiveIntegerField()
    source_event_id = models.CharField(max_length=160)
    source_ref = models.CharField(max_length=500)
    paid_at = models.DateTimeField()
    observed_at = models.DateTimeField()
    currency = models.CharField(max_length=3)
    paid_total = models.DecimalField(max_digits=16, decimal_places=2)
    tax_collected = models.DecimalField(max_digits=16, decimal_places=2)
    refund_total = models.DecimalField(max_digits=16, decimal_places=2)
    tax_refunded = models.DecimalField(max_digits=16, decimal_places=2)
    procurement = models.DecimalField(max_digits=16, decimal_places=2, null=True)
    shipping = models.DecimalField(max_digits=16, decimal_places=2, null=True)
    platform_payment = models.DecimalField(max_digits=16, decimal_places=2, null=True)
    advertising = models.DecimalField(max_digits=16, decimal_places=2, null=True)
    other = models.DecimalField(max_digits=16, decimal_places=2, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['store', 'external_order_id', 'revision'], name='finance_order_revision'),
            models.UniqueConstraint(fields=['store', 'source_event_id'], name='finance_source_event'),
        ]
        indexes = [models.Index(fields=['team', 'currency', 'paid_at'], name='finance_daily_lookup')]
