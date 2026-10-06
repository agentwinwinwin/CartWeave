from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from apps.skills.models import SkillVersion
from apps.skills.registry import handler_hash, check_skill
from apps.skills.opportunity import KEY, HANDLER, VERSION
from apps.skills import opportunity_market,opportunity_cj,opportunity_orders,opportunity_listings
from apps.audit.models import AuditRecord

class Command(BaseCommand):
    help='Register the reviewed closed opportunity algorithm in the existing private workspace; never replace versions.'

    @transaction.atomic
    def handle(self,*args,**options):
        if not (settings.LOCAL and settings.DESKTOP_MODE):
            raise CommandError('Only explicit local desktop mode supports this installation command.')
        owner=get_user_model().objects.filter(username=settings.DESKTOP_OWNER,is_active=True).first()
        memberships=list(owner.membership_set.filter(active=True)) if owner else []
        if len(memberships)!=1 or memberships[0].role!='admin':
            raise CommandError('Existing workspace owner is missing or ambiguous; no account will be created.')
        member=memberships[0]
        if sum(bool(options[k]) for k in ('market','cj','cj_orders','cj_listings'))>1:raise CommandError('Choose one version.')
        handler,version=(opportunity_orders.HANDLER,opportunity_orders.VERSION) if options['cj_orders'] else (opportunity_cj.HANDLER,opportunity_cj.VERSION) if options['cj'] else (opportunity_market.HANDLER,opportunity_market.VERSION) if options['market'] else (HANDLER,VERSION)
        if options['cj_listings']:handler,version=opportunity_listings.HANDLER,opportunity_listings.VERSION
        existing=SkillVersion.objects.filter(team=member.team,key=KEY,version=version).first()
        if existing:
            check_skill(existing)
            self.stdout.write('Reviewed opportunity skill already registered; unchanged.')
            return
        note='Reviewed deterministic formula and fixed data boundaries; algorithm and full 15-node test-store regression tested. No model, network, script uploads, sales predictions or automatic purchases.'
        skill=SkillVersion.objects.create(team=member.team,key=KEY,version=version,handler=handler,
            artifact_hash=handler_hash(handler),status='approved',reviewed_by=owner,reviewed_at=timezone.now(),review_note=note)
        for action in ('skill.registered','skill.approved'):
            AuditRecord.objects.create(team=member.team,actor=owner,action=action,object_id=str(skill.id),metadata={'reason':note})
        self.stdout.write('Reviewed opportunity skill registered. Existing workflow configurations unchanged.')
    def add_arguments(self,parser):
        parser.add_argument('--cj-listings',action='store_true',help='Register v5 order demand and listing-interest scoring.')
        parser.add_argument('--cj-orders',action='store_true',help='Register CJ order-count v4; period unknown, not 90-day unit sales.')
        parser.add_argument('--market',action='store_true',help='Register demand/competition v2 instead of legacy supply v1.')
        parser.add_argument('--cj',action='store_true',help='Register automatic CJ 90-day sales v3; never synthesize target-market evidence.')
