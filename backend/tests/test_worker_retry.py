from io import StringIO
from unittest.mock import patch
from django.test import SimpleTestCase
from django.db import OperationalError
from apps.runtime.management.commands.runworker import Command


class WorkerRetryTests(SimpleTestCase):
    def setUp(self):
        # This suite isolates the worker loop; scheduler database coverage is separate.
        dispatcher=patch('apps.runtime.management.commands.runworker.dispatch_schedules')
        dispatcher.start()
        self.addCleanup(dispatcher.stop)

    def test_scheduler_database_lock_retries_without_starting_jobs(self):
        cmd=Command(stdout=StringIO(),stderr=StringIO())
        with patch('apps.runtime.management.commands.runworker.dispatch_schedules',side_effect=[OperationalError('database is locked'),None]) as dispatcher, \
             patch('apps.runtime.management.commands.runworker.due_jobs',side_effect=[[],KeyboardInterrupt]), \
             patch('apps.runtime.management.commands.runworker.due_selection_tasks',return_value=[]), \
             patch('apps.runtime.management.commands.runworker.close_old_connections'), \
             patch('apps.runtime.management.commands.runworker.time.sleep') as sleep:
            cmd.handle(once=False)
        self.assertEqual(dispatcher.call_count,2)
        sleep.assert_any_call(2)

    def test_lock_keeps_worker_alive_without_immediate_action_replay(self):
        cmd=Command(stdout=StringIO(),stderr=StringIO())
        with patch('apps.runtime.management.commands.runworker.due_jobs',side_effect=[[1],[1],KeyboardInterrupt]), \
             patch('apps.runtime.management.commands.runworker.process_job',side_effect=[OperationalError('database is locked'),True]) as process, \
             patch('apps.runtime.management.commands.runworker.due_selection_tasks',return_value=[]), \
             patch('apps.runtime.management.commands.runworker.close_old_connections'), \
             patch('apps.runtime.management.commands.runworker.time.sleep') as sleep:
            cmd.handle(once=False)
        self.assertEqual(process.call_count,2)
        sleep.assert_any_call(2)
        self.assertIn('task retained',cmd.stderr.getvalue())

    def test_other_database_errors_are_not_silently_retried(self):
        with patch('apps.runtime.management.commands.runworker.due_jobs',side_effect=OperationalError('no such table')):
            with self.assertRaises(OperationalError):Command(stdout=StringIO()).handle(once=True)
