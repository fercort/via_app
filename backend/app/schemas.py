from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

VehicleCategory = Literal["car", "motorcycle", "bus", "truck"]
ResolutionMode = Literal["native", "1280", "640"]


class VirtualLineConfig(BaseModel):
    """Línea virtual normalizada en coordenadas [0.0, 1.0]."""

    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=80)
    color: str = Field(..., min_length=4, max_length=32)
    x1: float = Field(..., ge=0.0, le=1.0)
    y1: float = Field(..., ge=0.0, le=1.0)
    x2: float = Field(..., ge=0.0, le=1.0)
    y2: float = Field(..., ge=0.0, le=1.0)


class AnalysisConfig(BaseModel):
    """Configuración de inferencia y líneas virtuales enviada desde el cliente."""

    lines: list[VirtualLineConfig] = Field(..., min_length=1)
    confidence: float = Field(default=0.35, ge=0.05, le=0.95)
    frame_stride: int = Field(default=2, ge=1, le=10)
    model_name: str = Field(default="yolo26n.pt", min_length=1, max_length=120)
    live_preview: bool = Field(
        default=True,
        description="Si es True, emite fotogramas anotados en base64 y métricas parciales durante el análisis.",
    )
    enabled_classes: list[VehicleCategory] = Field(
        default_factory=lambda: ["car", "motorcycle", "bus", "truck"],
        min_length=1,
        description="Clases vehiculares activas para detección y conteo.",
    )
    resolution_mode: ResolutionMode = Field(
        default="native",
        description="Resolución interna de inferencia YOLO ('native' mantiene 1:1 sin reducir).",
    )
    moto_boost: bool = Field(
        default=True,
        description="Aplica umbral de confianza más sensible para motocicletas sin relajar otras clases.",
    )

    @field_validator("model_name")
    @classmethod
    def validate_model_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned or "/" in cleaned or "\\" in cleaned or ".." in cleaned:
            raise ValueError("Nombre de modelo inválido.")
        if Path(cleaned).suffix != ".pt":
            raise ValueError("El modelo debe corresponder a un archivo de pesos .pt.")
        return cleaned


class ClassCounts(BaseModel):
    """Conteo desglosado por clase vehicular COCO."""

    car: int = Field(default=0, ge=0)
    motorcycle: int = Field(default=0, ge=0)
    bus: int = Field(default=0, ge=0)
    truck: int = Field(default=0, ge=0)
    total: int = Field(default=0, ge=0)


class LineMetrics(BaseModel):
    """Métricas de cruce IN, OUT y Total para una línea virtual."""

    line_id: str
    line_name: str
    color: str
    counts_in: ClassCounts
    counts_out: ClassCounts
    counts_total: ClassCounts


class VideoMetadata(BaseModel):
    """Metadatos nativos del video procesado."""

    filename: str
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    fps: float = Field(..., gt=0.0)
    total_frames: int = Field(..., ge=0)
    analyzed_frames: int = Field(..., ge=0)
    duration_sec: float = Field(..., ge=0.0)


class ProgressEvent(BaseModel):
    """Evento de avance en tiempo real emitido durante el procesamiento."""

    status: Literal["processing"] = "processing"
    progress: int = Field(..., ge=0, le=100)
    current_frame: int = Field(..., ge=0)
    total_frames: int = Field(..., ge=0)
    active_detections: int = Field(default=0, ge=0)
    preview_frame: str | None = Field(default=None)
    metrics: list[LineMetrics] | None = Field(default=None)


class CompletedEvent(BaseModel):
    """Evento final con métricas consolidadas y metadatos del análisis."""

    status: Literal["completed"] = "completed"
    processing_time_sec: float = Field(..., ge=0.0)
    video_metadata: VideoMetadata
    metrics: list[LineMetrics]


class ErrorEvent(BaseModel):
    """Evento emitido si ocurre un error durante el procesamiento del stream."""

    status: Literal["error"] = "error"
    detail: str
