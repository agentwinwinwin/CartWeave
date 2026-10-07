"""Bounded image editing transport, not a conversational provider or arbitrary URL tool."""
import base64
import hashlib
import io
import json
import time
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from PIL import Image, UnidentifiedImageError
from django.conf import settings
from apps.common.errors import RuleError
from apps.connections.services import credential
from apps.connections.model_gateway import validate_endpoint
from contracts.assets import allowed_image

MODEL = 'gpt-image-2.5-sunburst'
LIMIT = 12_000_000


class ImageResultUnknown(RuleError):
    pass


def fingerprint(connection):
    fields = [connection.protocol, connection.base_url, connection.model_id, connection.credential_ciphertext]
    return hashlib.sha256(json.dumps(fields).encode()).hexdigest()


def check_generator(connection):
    if (connection.protocol not in {'openai-completions','openai-responses'} or
            connection.base_url.rstrip('/') != 'https://api.openai.com/v1' or
            connection.model_id not in {MODEL, MODEL+'-2026-09-08'} or not connection.credential_ciphertext):
        raise RuleError('生图连接需使用 OpenAI 官方 https://api.openai.com/v1、Sunburst 模型 ID 及 API Key。初版不接受未经验证的中转。')


def validate_png(content):
    if len(content)>LIMIT: raise RuleError('图片超过 12MB，未作为可交付素材保存。')
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format!='PNG' or image.width*image.height>20_000_000:
                raise RuleError('生图结果不是受支持的 PNG，或尺寸超过安全范围。')
            dimensions=image.size
            image.verify()
        return dimensions
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise RuleError('图片文件损坏或无法核验。') from None


def read_limited(response, limit, seconds):
    pieces=[]; size=0; started=time.monotonic()
    for part in response.iter_bytes():
        size+=len(part)
        if size>limit or time.monotonic()-started>seconds: raise RuleError('图片服务响应超过大小或时间限制。')
        pieces.append(part)
    return b''.join(pieces)


def reference_bytes(source):
    if not allowed_image(source): raise RuleError('原图不在受信商品素材范围内。')
    if source.startswith('/'):
        root=(Path(settings.BASE_DIR).parent/'public').resolve()
        file=(root/source.lstrip('/')).resolve()
        if not file.is_relative_to(root) or file.stat().st_size>LIMIT: raise RuleError('原图路径或大小不合法。')
        content=file.read_bytes()
    else:
        # Only the two approved CJ CDN hosts. Never forward model credentials,
        # cookies, redirects, or arbitrary user-supplied URLs.
        validate_endpoint('https://'+urlsplit(source).hostname)
        try:
            with httpx.Client(timeout=25, follow_redirects=False, trust_env=False) as client:
                with client.stream('GET', source) as response:
                    if response.status_code!=200: raise RuleError('CJ 商品原图无法读取，请核对素材。')
                    content=read_limited(response,LIMIT,25)
        except httpx.HTTPError:
            raise RuleError('CJ 商品原图读取失败；未调用生图服务。') from None
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.width*image.height>20_000_000 or image.format not in {'PNG','JPEG','WEBP'}:
                raise RuleError('原图格式或像素数不受支持。')
            image.load()
            output=io.BytesIO(); image.convert('RGB').save(output,format='PNG')
            data=output.getvalue()
            if len(data)>LIMIT: raise RuleError('转换后的原图超过安全大小。')
            return data
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError):
        raise RuleError('商品原图损坏或无法解码。') from None


def edit(connection, source, shot, config):
    check_generator(connection)
    reference=reference_bytes(source)
    prompt=shot['prompt']+'\n以附图为商品身份依据，保留商品形状、颜色、结构、Logo 与配件，不虚构材质、尺寸、认证或功效。\n必须保留：'+json.dumps(shot['preserve'],ensure_ascii=False)+'\n禁止改动：'+json.dumps(shot['forbidden_changes'],ensure_ascii=False)
    key=credential(connection)
    try:
        with httpx.Client(timeout=httpx.Timeout(180,connect=20),follow_redirects=False,trust_env=False) as client:
            with client.stream('POST','https://api.openai.com/v1/images/edits',
                    headers={'Authorization':'Bearer '+key},
                    data={'model':connection.model_id,'prompt':prompt,'n':'1','size':config['size'],
                          'quality':config['quality'],'output_format':'png'},
                    files={'image':('product.png',reference,'image/png')}) as response:
                if response.status_code>=300:
                    if response.status_code>=500:
                        raise ImageResultUnknown('生图服务异常，结果和费用可能未知；本批次不会自动重试。')
                    raise RuleError(f'生图服务返回 HTTP {response.status_code}；未收到图片，不自动重试。')
                request_id=response.headers.get('x-request-id','')[:120]
                result=json.loads(read_limited(response,18_000_000,180))
        if len(result.get('data',[]))!=1: raise ValueError()
        content=base64.b64decode(result['data'][0]['b64_json'],validate=True)
        width,height=validate_png(content)
        if f'{width}x{height}'!=config['size']: raise RuleError('输出尺寸不匹配，未通过文件检查；不会自动再次生成。')
        raw_usage=result.get('usage',{})
        usage={k:v for k,v in raw_usage.items() if type(v) is int} if isinstance(raw_usage,dict) else {}
        return content,width,height,request_id,usage
    except (httpx.HTTPError,ValueError,KeyError,TypeError):
        raise ImageResultUnknown('生图请求未获得可核验结果，费用可能已发生；不自动重试，请先核对服务商记录。') from None
