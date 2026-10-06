from django.conf import settings
from django.db import models
from apps.common.models import TeamRecord, ImmutableRecord

class MarketEvidence(ImmutableRecord):
    name=models.CharField(max_length=100)
    document=models.JSONField()
    digest=models.CharField(max_length=64)
    submitted_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT)

class SkillVersion(TeamRecord):
    key = models.CharField(max_length=100)
    version = models.CharField(max_length=40)
    handler = models.CharField(max_length=100)
    artifact_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=20, default='pending', choices=[(x, x) for x in ('pending', 'approved', 'revoked')])
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    reviewed_at = models.DateTimeField(null=True)
    review_note = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team', 'key', 'version'], name='unique_skill_version')]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if any(getattr(old, field) != getattr(self, field) for field in ('team_id', 'key', 'version', 'handler', 'artifact_hash')):
                raise ValueError('Skill implementation versions are immutable.')
        super().save(*args, **kwargs)
