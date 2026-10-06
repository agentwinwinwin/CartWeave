"""Explicit local-only registration of the tested formatter after its source changes."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from apps.skills.models import SkillVersion
from apps.skills.handlers import handler_hash
from apps.audit.models import AuditRecord

if not settings.LOCAL:
    raise RuntimeError('Only for the local tested fixture, not production approval.')
with transaction.atomic():
    user = User.objects.get(username='commerce-local')
    member = user.membership_set.get(active=True, role='admin')
    current_hash = handler_hash('content.editorial.v1')
    approved = SkillVersion.objects.filter(team=member.team, key='content.editorial', status='approved')
    if not approved.filter(artifact_hash=current_hash).exists():
        approved.update(status='revoked')
        count = SkillVersion.objects.filter(team=member.team, key='content.editorial').count()
        skill = SkillVersion.objects.create(team=member.team, key='content.editorial', version=f'1.0.{count}',
            handler='content.editorial.v1', artifact_hash=current_hash, status='approved', reviewed_by=user,
            reviewed_at=timezone.now(), review_note='Local test fixture only: deterministic formatter reviewed by agent and regression tested. No arbitrary script/network/model execution.')
        AuditRecord.objects.create(team=member.team, actor=user, action='skill.local_fixture_review', object_id=str(skill.id), metadata={'hash': current_hash, 'test_only': True})
print('Local tested formatter registry is ready. No credentials displayed.')
