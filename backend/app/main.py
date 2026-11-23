import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Iterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.processor import analyze_video_stream
from app.schemas import AnalysisConfig, ErrorEvent

DEFAULT_LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


def _get_allowed_origins() -> list[str]:
    """Lee ALLOWED_ORIGINS desde variables de entorno con fallback local."""
    raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw_origins:
        return DEFAULT_LOCAL_ORIGINS
    origins = [origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip()]
    return origins or DEFAULT_LOCAL_ORIGINS


app = FastAPI(
    title="Traffic Counter YOLO26 API",
    description="API de aforo y clasificación vehicular con líneas virtuales, YOLO26 y ByteTrack.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Endpoint de verificación para despliegue en contenedores Cloud."""
    return {"status": "ok"}


@app.post("/api/analyze")
def analyze_video(
    video: UploadFile = File(...),
    config: str = Form(...),
) -> StreamingResponse:
    """
    Recibe un video y configuración JSON de líneas virtuales, guarda el archivo
    temporalmente garantizando su eliminación en try...finally y retorna un stream NDJSON.
    """
    original_filename = video.filename or "video.mp4"
    suffix = Path(original_filename).suffix.lower()
    if suffix not in SUPPORTED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Formato no soportado ({suffix or 'desconocido'}). Usa .mp4, .avi o .mov.",
        )

    try:
        raw_config = json.loads(config)
        parsed_config = AnalysisConfig.model_validate(raw_config)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"JSON inválido en config: {exc}") from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            video.file.seek(0)
            shutil.copyfileobj(video.file, temp_file)
    except Exception as exc:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise HTTPException(
            status_code=500,
            detail=f"Error al almacenar temporalmente el video: {exc}",
        ) from exc
    finally:
        video.file.close()

    def event_stream() -> Iterator[bytes]:
        try:
            for event in analyze_video_stream(
                video_path=temp_path,
                config=parsed_config,
                original_filename=original_filename,
            ):
                yield (json.dumps(event) + "\n").encode("utf-8")
        except Exception as exc:
            error_event = ErrorEvent(detail=str(exc)).model_dump()
            yield (json.dumps(error_event) + "\n").encode("utf-8")
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
