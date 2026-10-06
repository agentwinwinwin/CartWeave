from django.core.management.base import BaseCommand
from apps.identity.bootstrap import bootstrap_local

class Command(BaseCommand):
    help = 'Create a development team and test-only reviewed formatter; no fixed password.'
    def handle(self, *args, **options):
        bootstrap_local()
        self.stdout.write('Local team ready. Login credentials are in backend/.local/development-access.json, not displayed.')
