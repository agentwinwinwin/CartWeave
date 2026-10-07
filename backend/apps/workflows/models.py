from django.db import models
from apps.common.models import TeamRecord, ImmutableRecord

class WorkflowDraft(TeamRecord):
    title = models.CharField(max_length=200)
    revision = models.PositiveIntegerField(default=1)
    document = models.JSONField()
    skill = models.ForeignKey('skills.SkillVersion', on_delete=models.PROTECT, null=True)

class WorkflowVersion(ImmutableRecord):
    workflow = models.ForeignKey(WorkflowDraft, on_delete=models.PROTECT, related_name='versions')
    revision = models.PositiveIntegerField()
    document = models.JSONField()
    digest = models.CharField(max_length=64)
    skill = models.ForeignKey('skills.SkillVersion', on_delete=models.PROTECT, null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workflow', 'revision'], name='unique_workflow_revision')]

class WorkflowDesign(TeamRecord):
    updated_at = models.DateTimeField(auto_now=True)
    client_id = models.CharField(max_length=100)
    revision = models.PositiveIntegerField(default=1)
    document = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['team', 'client_id'], name='unique_team_design')]

class DesignRelease(ImmutableRecord):
    design = models.ForeignKey(WorkflowDesign, on_delete=models.PROTECT)
    revision = models.PositiveIntegerField()
    document = models.JSONField()
    digest = models.CharField(max_length=64)
    version = models.OneToOneField(WorkflowVersion, on_delete=models.PROTECT, related_name='design_release')
    store = models.ForeignKey('connections.Store', on_delete=models.PROTECT)
    store_version = models.PositiveIntegerField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['design', 'revision'], name='unique_design_release')]

class ReleaseRetirement(TeamRecord):
    """Recoverable visibility state, separate from the immutable frozen payload."""
    release = models.OneToOneField(DesignRelease, on_delete=models.PROTECT, related_name='retirement')
    retired_by = models.ForeignKey('auth.User', on_delete=models.PROTECT)
