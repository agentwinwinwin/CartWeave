from rest_framework.exceptions import PermissionDenied
from .models import Membership

def membership(request, roles=None):
    team_id = request.headers.get('X-Team-ID')
    query = Membership.objects.filter(user=request.user, active=True)
    if team_id:
        from uuid import UUID
        try:
            UUID(team_id)
        except ValueError:
            raise PermissionDenied('团队标识无效。')
        query = query.filter(team_id=team_id)
    elif query.count() != 1:
        raise PermissionDenied('请选择明确的团队。')
    member = query.first()
    if not member or roles and member.role not in roles and member.role != 'admin':
        raise PermissionDenied('没有执行该操作的团队权限。')
    return member

def require_role(user, team, roles):
    member = Membership.objects.filter(user=user, team=team, active=True).first()
    if not user.is_active or not member or member.role not in set(roles) | {'admin'}:
        raise PermissionDenied('成员权限已失效。')
