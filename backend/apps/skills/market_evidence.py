"""Typed operator-supplied evidence; never fetch URLs or label imports as verified sales."""
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID
from urllib.parse import urlparse
from django.utils import timezone
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from apps.common.errors import RuleError
from .models import MarketEvidence

class Observation(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    cj_pid:str=Field(min_length=1,max_length=100)
    match_note:str=Field(min_length=5,max_length=500)
    sales_kind:Literal['observed','estimated']
    sales_30d:int|None=Field(default=None,ge=0,le=100000000,strict=True)
    previous_sales_30d:int|None=Field(default=None,ge=0,le=100000000,strict=True)
    searches_30d:int|None=Field(default=None,ge=0,le=100000000,strict=True)
    previous_searches_30d:int|None=Field(default=None,ge=0,le=100000000,strict=True)
    competitor_count:int|None=Field(default=None,ge=0,le=1000000,strict=True)
    competitor_median_price:Decimal|None=Field(default=None,gt=0,le=100000,decimal_places=2)
    acquisition_cost:Decimal|None=Field(default=None,ge=0,le=100000,decimal_places=2)

class EvidenceDocument(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    schema_version:Literal['MarketEvidence@1']='MarketEvidence@1'
    name:str=Field(min_length=1,max_length=100)
    market:str=Field(pattern=r'^[A-Z]{2}$')
    currency:str=Field(pattern=r'^[A-Z]{3}$')
    channel:str=Field(min_length=1,max_length=80)
    source_name:str=Field(min_length=2,max_length=100)
    source_url:str=Field(min_length=1,max_length=2000)
    observed_on:date
    period_end:date
    rows:list[Observation]=Field(min_length=1,max_length=50)

    @field_validator('source_url')
    @classmethod
    def safe_reference(cls,value):
        parsed=urlparse(value)
        if parsed.scheme!='https' or not parsed.hostname or parsed.hostname.endswith('.example') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('提供无凭证、无查询参数的 HTTPS 来源引用；系统不会抓取此链接。')
        return value

    @model_validator(mode='after')
    def dates_and_identity(self):
        today=timezone.now().date()
        if self.period_end>self.observed_on or self.observed_on>today:
            raise ValueError('窗口结束时间不能晚于采集时间，采集不能在未来。')
        if len({r.cj_pid for r in self.rows})!=len(self.rows):raise ValueError('CJ 商品映射不能重复。')
        return self

def evidence_for(team,reference,market,currency):
    try:row=MarketEvidence.objects.get(pk=UUID(reference),team=team)
    except (ValueError,TypeError,AttributeError,MarketEvidence.DoesNotExist):
        raise RuleError('请在评估节点导入并选择有效市场证据；不能用 CJ 刊登次数或库存代替销量。')
    document=EvidenceDocument.model_validate(row.document).model_dump(mode='json')
    from apps.common.utils import digest
    if digest(document)!=row.digest:raise RuleError('市场证据摘要不一致，不能执行。')
    if document['market']!=market or document['currency']!=currency:raise RuleError('市场证据国家或币种与商品任务不一致。')
    cutoff=timezone.now().date()-timedelta(days=7)
    if date.fromisoformat(document['period_end'])<cutoff or date.fromisoformat(document['observed_on'])<cutoff:
        raise RuleError('市场证据已超过七天，请导入新版本，旧证据不会自动刷新。')
    return row,document
