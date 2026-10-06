import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('identity', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='AgentSession',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('purpose', models.CharField(max_length=40)),
                ('skill_digest', models.CharField(max_length=64)),
                ('messages', models.JSONField(default=list)),
                ('result', models.JSONField(default=dict)),
                ('revision', models.PositiveIntegerField(default=1)),
                ('busy_until', models.DateTimeField(null=True)),
                ('team', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='identity.team')),
            ],
            options={
                'abstract': False,
            },
        ),
    ]
