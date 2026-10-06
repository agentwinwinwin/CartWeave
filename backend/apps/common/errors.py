from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_handler

class Conflict(APIException):
    status_code = 409
    default_code = 'conflict'
    default_detail = '版本或状态已经改变。'

class RuleError(APIException):
    status_code = 422
    default_code = 'business_rule'

def exception_handler(exc, context):
    from django.db import IntegrityError
    from rest_framework.response import Response
    if isinstance(exc, IntegrityError):
        return Response({'code': 'database_conflict', 'detail': '资源已存在或关联约束不允许该操作。'}, status=409)
    response = drf_handler(exc, context)
    if response is not None:
        response.data = {'code': getattr(exc, 'default_code', 'invalid_request'), 'detail': response.data}
    return response
