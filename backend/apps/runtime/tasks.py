from celery import shared_task
from .services import due_jobs, process_job

@shared_task
def execute_job(job_id):
    return process_job(job_id)

@shared_task
def dispatch():
    from .scheduling import dispatch_schedules
    dispatch_schedules()
    for job_id in list(due_jobs()):
        execute_job.delay(str(job_id))
    from .selection import due_selection_tasks
    for pk in list(due_selection_tasks()):
        execute_selection.delay(str(pk))

@shared_task
def execute_selection(pk):
    from .selection import process_selection
    process_selection(pk)
