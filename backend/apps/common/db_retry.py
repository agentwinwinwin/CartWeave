from django.db import OperationalError, connection


def transient_database_lock(exc):
    """Only SQLite contention is retryable; other failures must remain visible."""
    return isinstance(exc, OperationalError) and connection.vendor == 'sqlite' and str(exc).lower() in (
        'database is locked', 'database table is locked', 'database schema is locked')
