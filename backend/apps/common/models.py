import uuid
from django.db import models

class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True

class TeamRecord(Record):
    team = models.ForeignKey('identity.Team', on_delete=models.PROTECT)

    class Meta:
        abstract = True

class ImmutableRecord(TeamRecord):
    """Historical payloads can be inserted but not updated through the model API."""
    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Immutable record: create a new version.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Historical records cannot be deleted.')

    class Meta:
        abstract = True
