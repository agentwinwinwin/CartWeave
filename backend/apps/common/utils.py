import hashlib
import json
from rest_framework.exceptions import ValidationError

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def parse(model, data):
    from pydantic import ValidationError as PydanticError
    try:
        return model.model_validate(data).model_dump(mode='json')
    except PydanticError as exc:
        raise ValidationError([{'field': '.'.join(map(str, e['loc'])), 'message': e['msg']} for e in exc.errors()])
