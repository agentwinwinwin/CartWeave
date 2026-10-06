"""Trusted local UI transport, not a public anonymous-authentication switch."""
import hashlib
import hmac
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


def desktop_token():
    return hmac.new(settings.SECRET_KEY.encode(), b'commerceos-desktop-transport-v1', hashlib.sha256).hexdigest()


class DesktopAuthentication(BaseAuthentication):
    def authenticate(self, request):
        token = request.headers.get('X-Commerce-Desktop', '')
        if not settings.DESKTOP_MODE:
            return None
        if not settings.LOCAL or request.META.get('REMOTE_ADDR') not in ('127.0.0.1', '::1'):
            raise AuthenticationFailed('私人工作区仅允许本机访问。')
        if not token or not hmac.compare_digest(token, desktop_token()):
            raise AuthenticationFailed('请通过本机桌面工作台访问。')
        user = get_user_model().objects.filter(username=settings.DESKTOP_OWNER, is_active=True).first()
        if not user or user.membership_set.filter(active=True, role='admin').count() != 1 or user.membership_set.filter(active=True).count() != 1:
            raise AuthenticationFailed('私人工作区身份未配置或存在歧义；不会自动选择或修改其他工作区。')
        return user, 'desktop'
