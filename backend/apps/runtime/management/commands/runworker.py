import time
from django.core.management.base import BaseCommand
from django.db import close_old_connections, OperationalError
from apps.common.db_retry import transient_database_lock
from apps.runtime.services import due_jobs, process_job
from apps.runtime.selection import due_selection_tasks, process_selection
from apps.runtime.scheduling import dispatch_schedules

class Command(BaseCommand):
    help = 'Durable local worker without Redis; uses the same jobs as Celery. Single worker for SQLite.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true')

    def handle(self, *args, **options):
        self.stdout.write('Durable worker ready; remote spend/message handlers are not installed.')
        last_dispatch = 0
        try:
            while True:
                close_old_connections()
                try:
                    if time.monotonic() - last_dispatch >= 5:
                        dispatch_schedules()
                        last_dispatch = time.monotonic()
                    jobs = list(due_jobs())
                    for job in jobs:
                        process_job(job)
                    for task in list(due_selection_tasks()):
                        process_selection(task)
                except OperationalError as exc:
                    if not transient_database_lock(exc):
                        raise
                    # Do not replay external actions here. The durable lease and
                    # original idempotency key decide when/how to reclaim safely.
                    close_old_connections()
                    self.stderr.write('Database busy; task retained. Rechecking durable leases in 2 seconds.')
                    if options['once']:
                        return
                    time.sleep(2)
                    continue
                if options['once']:
                    return
                # Account-wide CJ slots pace requests. Don't add a half-second
                # delay to every persisted SKU result on top of that limiter.
                time.sleep(0.05 if jobs else 1)
        except KeyboardInterrupt:
            self.stdout.write('Worker stopped; pending jobs remain in the database.')
