from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('teststore', '0001_initial')]
    operations = [
        migrations.AddField(model_name='publishedproduct', name='unpublish_key', field=models.CharField(blank=True, max_length=64, null=True)),
        migrations.AddConstraint(model_name='publishedproduct', constraint=models.UniqueConstraint(fields=('client', 'unpublish_key'), name='unique_store_unpublish')),
    ]
