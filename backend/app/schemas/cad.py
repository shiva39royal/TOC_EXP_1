from typing import Literal, Optional

from pydantic import BaseModel

JobStatus = Literal[
    "uploading", "processing", "converting", "preparing", "rendering", "completed", "failed"
]


class Bounds(BaseModel):
    minX: float
    minY: float
    maxX: float
    maxY: float


class UploadResponse(BaseModel):
    jobId: str
    fileName: str
    status: JobStatus


class JobResponse(BaseModel):
    jobId: str
    fileName: str
    status: JobStatus
    progress: int
    stage: str
    error: Optional[str] = None


class LayoutInfo(BaseModel):
    id: int
    name: str
    isModel: bool
    entityCount: int
    bounds: Optional[Bounds] = None
    renderUrl: str


class LayerCatalogItem(BaseModel):
    id: int
    name: str
    color: str
    isLocked: bool = False
    isVisible: bool = True
    count: int = 0


class CategoryItem(BaseModel):
    id: int
    key: str
    name: str
    icon: str = ""
    description: str = ""
    count: int = 0


class DocumentResponse(BaseModel):
    id: str
    fileName: str
    fileSize: int
    bounds: Optional[Bounds] = None
    renderUrl: str
    defaultLayout: int
    layouts: list[LayoutInfo]
    warnings: list[str] = []
    converter: str = ""
    categories: list[CategoryItem] = []
    cadLayers: list[LayerCatalogItem] = []
    isFromTables: bool = False


class ComponentMove(BaseModel):
    id: str
    dx: float
    dy: float


class ComponentUpdate(BaseModel):
    id: str
    tags: Optional[dict[str, str]] = None
    layer: Optional[str] = None
    color: Optional[int] = None


class ComponentAddition(BaseModel):
    temp_id: str
    source_handle: str
    sub_role: Optional[str] = None
    insert_pos: list[float]
    source_anchor: Optional[list[float]] = None
    tags: Optional[dict[str, str]] = None
    layer: Optional[str] = None
    color: Optional[int] = None


class ModifyDrawingRequest(BaseModel):
    moves: list[ComponentMove] = []
    updates: list[ComponentUpdate] = []
    deletions: list[str] = []
    additions: list[ComponentAddition] = []


# -----------------------------------------------------------------------------
# Plan.md Section 11 Data Contracts
# -----------------------------------------------------------------------------
class GeometryPayload(BaseModel):
    world_anchor: list[float]
    bounding_box: list[float]
    rotation: float = 0.0
    scale: list[float] = [1.0, 1.0]
    transform_matrix: list[float] = []
    original_coordinates: Optional[list[float]] = None


class ClassificationRecord(BaseModel):
    category: str
    component_type: str
    evidence_tier: str = "DECLARATIVE_ONTOLOGY"
    evidence_details: Optional[str] = None
    classification_status: str = "CONFIRMED"


class BitmapMatchRecord(BaseModel):
    status: Literal["CONFIRMED", "NEEDS_REVIEW", "UNMATCHED"]
    asset_id: Optional[str] = None
    relative_path: Optional[str] = None
    resolution_tier: int = 1
    candidate_results: list[str] = []
    evidence: list[str] = []
    warnings: list[str] = []
    manual_override: Optional[bool] = False


class ExtractedComponentContract(BaseModel):
    component_id: str
    source_handles: list[str]
    block_name: str
    layer_name: str
    attributes: dict[str, str] = {}
    geometry: GeometryPayload
    classification: ClassificationRecord
    bitmap_match: Optional[BitmapMatchRecord] = None
    disposition: Literal[
        "ASSIGNED_TO_COMPONENT",
        "NATIVE_CAD_GEOMETRY",
        "ANNOTATION",
        "INTENTIONALLY_IGNORED_WITH_REASON",
        "UNRESOLVED"
    ] = "ASSIGNED_TO_COMPONENT"


class BitmapOverrideRequest(BaseModel):
    component_id: str
    override_bitmap: str
    reason: str = "Manual operator assignment"
    user: Optional[str] = "operator"


class BitmapOverrideRecord(BaseModel):
    component_id: str
    original_bitmap: str
    override_bitmap: str
    reason: str
    timestamp: str
    user: str


