from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [('workflows', '0004_releaseretirement')]
    operations = [migrations.AlterField(model_name=name, name='skill',
        field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to='skills.skillversion'))
        for name in ['workflowdraft', 'workflowversion']]
