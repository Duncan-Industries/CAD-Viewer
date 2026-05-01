"""
CADViewer Backend — FastAPI
Endpoints:
  POST /api/upload          Upload a CAD file, returns processed data + GLTF URL
  GET  /api/files/{id}.glb  Serve converted GLB
  GET  /api/health          Health check
"""

import os
import uuid
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

import services.cad_processor as processor
import services.annotation_extractor as extractor
import services.feature_measure as feature_measure
from models.schemas import (
    ProcessedFile,
    ProcessingTimings,
    FeatureMeasureRequest,
    FeatureMeasureResponse,
    FileFeatureCatalog,
)


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="CADViewer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory where converted GLB files live
GLB_DIR = os.environ.get("GLB_DIR", "/tmp/cadviewer_glb")
os.makedirs(GLB_DIR, exist_ok=True)

# Max upload size: 500 MB
MAX_FILE_SIZE = 500 * 1024 * 1024

FILE_FEATURE_CACHE: dict[str, dict] = {}


def _now_ms() -> int:
    return int(time.perf_counter() * 1000)


def _api_error(
    status_code: int,
    code: str,
    message: str,
    stage: str | None = None,
    detail: str | None = None,
):
    payload = {"error": {"code": code, "message": message, "stage": stage, "detail": detail}}
    return JSONResponse(status_code=status_code, content=payload)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return _api_error(exc.status_code, "http_error", detail, detail=detail)


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception):
    return _api_error(500, "internal_error", "Unhandled server error.", detail=str(exc))


@app.post("/api/upload", response_model=ProcessedFile)
async def upload_cad_file(file: UploadFile = File(...)):
    request_started_ms = _now_ms()
    filename = file.filename or "upload.step"
    ext = Path(filename).suffix.lower()

    if ext not in processor.SUPPORTED_EXTENSIONS:
        return _api_error(
            415,
            "unsupported_format",
            f"Unsupported format '{ext}'.",
            stage="upload",
            detail="Supported: " + ", ".join(sorted(processor.SUPPORTED_EXTENSIONS)),
        )

    file_id = str(uuid.uuid4())
    warnings: list[str] = []
    upload_started_ms = _now_ms()
    tmp_path = ""

    # Save upload to a temp file
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp_path = tmp.name
        chunk_size = 1024 * 1024  # 1 MB
        total = 0
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_FILE_SIZE:
                os.unlink(tmp_path)
                return _api_error(
                    413,
                    "file_too_large",
                    "File too large (max 500 MB).",
                    stage="upload",
                )
            tmp.write(chunk)
    upload_ms = _now_ms() - upload_started_ms

    glb_path = os.path.join(GLB_DIR, f"{file_id}.glb")
    convert_ms = 0
    extract_ms = 0
    try:
        convert_started_ms = _now_ms()
        # Convert to GLB
        glb_path, conversion_meta = processor.convert(tmp_path, filename, GLB_DIR, file_id)
        convert_ms = _now_ms() - convert_started_ms
        warnings.extend(conversion_meta.get("warnings", []))
        cache_hit = bool(conversion_meta.get("cache_hit", False))
        quality_profile = conversion_meta.get("quality_profile", "balanced")

        extract_started_ms = _now_ms()
        # Extract annotations & assembly tree
        info = extractor.extract(tmp_path, filename)
        extract_ms = _now_ms() - extract_started_ms

    except ValueError as e:
        if os.path.exists(glb_path):
            os.unlink(glb_path)
        return _api_error(415, "invalid_input", str(e), stage="convert")
    except RuntimeError as e:
        if os.path.exists(glb_path):
            os.unlink(glb_path)
        return _api_error(500, "conversion_error", str(e), stage="convert")
    except Exception as e:
        if os.path.exists(glb_path):
            os.unlink(glb_path)
        return _api_error(500, "processing_failed", "Processing failed.", stage="extract", detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    total_ms = _now_ms() - request_started_ms
    timings = ProcessingTimings(
        upload_ms=upload_ms,
        convert_ms=convert_ms,
        extract_ms=extract_ms,
        total_ms=total_ms,
    )
    warnings.extend([
        f"cache_hit={cache_hit}",
        f"tessellation_profile={quality_profile}",
    ])

    FILE_FEATURE_CACHE.pop(file_id, None)
    return ProcessedFile(
        file_id=file_id,
        gltf_url=f"/api/files/{file_id}.glb",
        metadata=info["metadata"],
        assembly=info["assembly"],
        annotations=info["annotations"],
        timings=timings,
        warnings=warnings,
    )


@app.get("/api/files/{file_id}.glb")
async def serve_glb(file_id: str):
    # Basic sanitisation — file_id must be a UUID
    try:
        uuid.UUID(file_id)
    except ValueError:
        raise HTTPException(400, "Invalid file ID.")

    glb_path = os.path.join(GLB_DIR, f"{file_id}.glb")
    if not os.path.exists(glb_path):
        raise HTTPException(404, "File not found.")

    return FileResponse(
        glb_path,
        media_type="model/gltf-binary",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/api/files/{file_id}/features", response_model=FileFeatureCatalog)
async def get_file_features(file_id: str):
    try:
        uuid.UUID(file_id)
    except ValueError:
        raise HTTPException(400, "Invalid file ID.")
    if file_id in FILE_FEATURE_CACHE:
        return FILE_FEATURE_CACHE[file_id]
    glb_path = os.path.join(GLB_DIR, f"{file_id}.glb")
    if not os.path.exists(glb_path):
        raise HTTPException(404, "File not found.")
    try:
        catalog = feature_measure.build_feature_catalog(glb_path, file_id)
        FILE_FEATURE_CACHE[file_id] = catalog
        return catalog
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Failed to compute feature catalog: {exc}")


@app.post("/api/files/{file_id}/measure", response_model=FeatureMeasureResponse)
async def measure_file_feature(file_id: str, payload: FeatureMeasureRequest):
    try:
        uuid.UUID(file_id)
    except ValueError:
        raise HTTPException(400, "Invalid file ID.")
    glb_path = os.path.join(GLB_DIR, f"{file_id}.glb")
    if not os.path.exists(glb_path):
        raise HTTPException(404, "File not found.")
    try:
        result = feature_measure.measure_feature(glb_path, file_id, payload.model_dump())
        return result
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Feature measurement failed: {exc}")
