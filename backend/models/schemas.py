from pydantic import BaseModel
from typing import Optional


class ProcessingTimings(BaseModel):
    upload_ms: int = 0
    convert_ms: int = 0
    extract_ms: int = 0
    total_ms: int = 0


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
    timings: ProcessingTimings = ProcessingTimings()
    warnings: list[str] = []


class FeatureValue(BaseModel):
    value: float
    unit: str
    display: str


class MeasurePoint(BaseModel):
    x: float
    y: float
    z: float


class FeatureMeasureRequest(BaseModel):
    measurement_type: str
    part_id: str
    feature_a: str
    feature_b: Optional[str] = None


class FeatureMeasureResponse(BaseModel):
    file_id: str
    measurement_type: str
    part_id: str
    feature_a: str
    feature_b: Optional[str] = None
    value: FeatureValue
    markers: list[MeasurePoint] = []


class PartFeatureSummary(BaseModel):
    id: str
    label: str
    kind: str


class PartSummary(BaseModel):
    id: str
    name: str
    feature_counts: dict[str, int]
    features: list[PartFeatureSummary] = []


class FileFeatureCatalog(BaseModel):
    file_id: str
    parts: list[PartSummary]


AssemblyNode.model_rebuild()
