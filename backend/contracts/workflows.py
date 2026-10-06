from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Binding(StrictModel):
    skillId: str = Field(min_length=1, max_length=100)
    skillVersion: str = Field(min_length=1, max_length=40)
    mode: Literal['default', 'custom']
    parameters: dict

class Node(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    definitionId: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    binding: Binding

class Edge(StrictModel):
    id: str = Field(min_length=1, max_length=220)
    source: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=100)
    kind: Literal['forward']

class Environment(StrictModel):
    channel: Literal['test-store']
    fulfillment: Literal['supplier']
    capabilities: list[str] = Field(max_length=10)

class Document(StrictModel):
    schemaVersion: Literal['2']
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    revision: int = Field(strict=True, ge=1)
    templateId: str = Field(min_length=1, max_length=100)
    environment: Environment
    nodes: list[Node] = Field(min_length=7, max_length=7)
    edges: list[Edge] = Field(min_length=6, max_length=6)
    customSkills: list = Field(max_length=0)
