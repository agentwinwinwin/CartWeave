from django.db import transaction
from apps.common.errors import Conflict
from apps.common.utils import digest
from apps.registry.definitions import validate_document
from .models import WorkflowVersion

@transaction.atomic
def update_draft(draft, document, expected_revision):
    draft = type(draft).objects.select_for_update().get(pk=draft.pk)
    if draft.revision != expected_revision:
        raise Conflict('流程草稿版本已改变。')
    validate_document(document, draft.skill)
    draft.revision += 1
    document = {**document, 'revision': draft.revision}
    draft.document, draft.title = document, document.get('title', draft.title)
    draft.save(update_fields=['document', 'title', 'revision'])
    return draft

@transaction.atomic
def freeze(draft, expected_revision):
    draft = type(draft).objects.select_for_update().get(pk=draft.pk)
    if draft.revision != expected_revision:
        raise Conflict('流程草稿版本已改变。')
    validate_document(draft.document, draft.skill)
    version, _ = WorkflowVersion.objects.get_or_create(workflow=draft, revision=draft.revision,
        defaults={'team': draft.team, 'document': draft.document, 'digest': digest(draft.document), 'skill': draft.skill})
    return version
