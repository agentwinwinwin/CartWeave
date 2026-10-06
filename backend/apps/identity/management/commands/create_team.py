from getpass import getpass
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from apps.identity.models import Team, Membership

class Command(BaseCommand):
    help = 'Provision the first internal administrator; no public registration or printed password.'
    def add_arguments(self, parser):
        parser.add_argument('--username', required=True)
        parser.add_argument('--team', required=True)
    def handle(self, *args, **options):
        if User.objects.filter(username=options['username']).exists():
            raise CommandError('Username already exists.')
        password = getpass('Administrator password: ')
        if password != getpass('Confirm password: '):
            raise CommandError('Passwords do not match.')
        user = User(username=options['username'])
        validate_password(password, user)
        with transaction.atomic():
            user.set_password(password)
            user.save()
            team = Team.objects.create(name=options['team'])
            Membership.objects.create(user=user, team=team, role='admin')
        self.stdout.write('Internal team and administrator created. Register and review installed Skills before execution.')
