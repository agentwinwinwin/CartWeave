import json
import os
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
LOCAL = os.environ.get('COMMERCE_ENV') == 'local'
DESKTOP_MODE = os.environ.get('COMMERCE_DESKTOP') == '1'
if DESKTOP_MODE and not LOCAL:
    raise ImproperlyConfigured('Desktop mode requires COMMERCE_ENV=local and loopback-only servers.')
DESKTOP_OWNER = os.environ.get('COMMERCE_DESKTOP_OWNER', 'commerce-local')
local_file = BASE_DIR / '.local' / 'config.json'
local = json.loads(local_file.read_text()) if LOCAL and local_file.exists() else {}
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or local.get('secret_key')
CREDENTIAL_KEY = os.environ.get('COMMERCE_CREDENTIAL_KEY') or local.get('credential_key')
if not SECRET_KEY or not CREDENTIAL_KEY:
    raise ImproperlyConfigured('Configure server secrets; for local development run scripts/configure_local.py.')
DEBUG = LOCAL
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver' if LOCAL else '').split(',')
INSTALLED_APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions',
    'django.contrib.messages', 'django.contrib.staticfiles', 'rest_framework',
    'apps.identity', 'apps.connections', 'apps.skills', 'apps.workflows',
    'apps.runtime', 'apps.approvals', 'apps.listings', 'apps.audit', 'apps.teststore', 'apps.finance', 'apps.commerce',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
]
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
if os.environ.get('POSTGRES_HOST'):
    DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('POSTGRES_DB', 'commerceos'), 'USER': os.environ.get('POSTGRES_USER', 'commerceos'),
        'PASSWORD': os.environ['POSTGRES_PASSWORD'], 'HOST': os.environ['POSTGRES_HOST'],
        'PORT': os.environ.get('POSTGRES_PORT', '5432'), 'CONN_MAX_AGE': 60}}
elif LOCAL:
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / '.local' / 'development.sqlite3',
                              'OPTIONS': {'timeout': 20, 'transaction_mode': 'IMMEDIATE'}}}
else:
    raise ImproperlyConfigured('Production requires PostgreSQL configuration.')
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['apps.identity.desktop.DesktopAuthentication', 'rest_framework.authentication.SessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'EXCEPTION_HANDLER': 'apps.common.errors.exception_handler',
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.UserRateThrottle', 'rest_framework.throttling.AnonRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {'user': '10000/hour', 'anon': '120/hour', 'login': '20/hour', 'store': '3000/hour'},
}
SESSION_COOKIE_NAME = 'commerceos_session'
CSRF_COOKIE_NAME = 'commerceos_csrf'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not LOCAL
CSRF_COOKIE_SECURE = not LOCAL
CSRF_TRUSTED_ORIGINS = os.environ.get('CSRF_TRUSTED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000' if LOCAL else '').split(',')
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = 'UTC'
USE_TZ = True
STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0')
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}} if LOCAL else {
    'default': {'BACKEND': 'django.core.cache.backends.redis.RedisCache', 'LOCATION': os.environ.get('CACHE_REDIS_URL', 'redis://redis:6379/1')}}
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_SOFT_TIME_LIMIT = 45
CELERY_TASK_TIME_LIMIT = 60
CELERY_BEAT_SCHEDULE = {'durable-outbox': {'task': 'apps.runtime.tasks.dispatch', 'schedule': 5.0}}
TEST_STORE_API_BASE = os.environ.get('TEST_STORE_API_BASE', 'http://127.0.0.1:8010/api/test-store/v1')
TEST_STORE_PUBLIC_BASE = os.environ.get('TEST_STORE_PUBLIC_BASE', 'http://localhost:3000/test-store')
