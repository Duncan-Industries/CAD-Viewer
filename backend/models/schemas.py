from pydantic import BaseModel
from typing import Optional


class ColorRGB(BaseModel):
    r: float
    g: float
    b: float


class AssemblyNode(BaseModel):
    id: str
    name: str
    type: str  # "assembly" | "part" | "body"
    color: Optional[ColorRGB] = None
    material: Optional[str] = None
    children: list["AssemblyNode"] = []


class Annotation(BaseModel):
    id: str
    type: str  # "note" | "dimension" | "gdt" | "surface_finish" | "weld"
    text: str
    component: Optional[str] = None
    position: Optional[dict] = None
    metadata: dict = {}


class FileMetadata(BaseModel):
    filename: str
    format: str
    file_size: int
    unit: Optional[str] = None
    author: Optional[str] = None
    organization: Optional[str] = None
    created: Optional[str] = None
    description: Optional[str] = None
    ap_standard: Optional[str] = None  # e.g. AP203, AP214, AP242


class ProcessedFile(BaseModel):
    file_id: str
    gltf_url: str
    metadata: FileMetadata
    assembly: list[AssemblyNode] = []
    annotations: list[Annotation] = []
    supported_format: bool = True


AssemblyNode.model_rebuild()
