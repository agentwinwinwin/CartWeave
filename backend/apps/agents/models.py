from django.db import models
from apps.common.models import TeamRecord


class AgentSession(TeamRecord):
    purpose=models.CharField(max_length=40)
    skill_digest=models.CharField(max_length=64)
    messages=models.JSONField(default=list)
    result=models.JSONField(default=dict)
    revision=models.PositiveIntegerField(default=1)
    busy_until=models.DateTimeField(null=True)
