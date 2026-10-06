from django.conf import settings
from django.db import models
from apps.common.models import Record

class Team(Record):
    name = models.CharField(max_length=100)

class Membership(models.Model):
    team = models.ForeignKey(Team, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    role = models.CharField(max_length=20, choices=[(x, x) for x in ('admin', 'operator', 'approver', 'viewer')])
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team', 'user'], name='unique_team_member')]
