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
import shutil
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import services.cad_processor as processor
import services.annotation_extractor as extractor
from models.schemas import ProcessedFile


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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/upload", response_model=ProcessedFile)
async def upload_cad_file(file: UploadFile = File(...)):
    filename = file.filename or "upload.step"
    ext = Path(filename).suffix.lower()

    if ext not in processor.SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported format '{ext}'. Supported: "
                   + ", ".join(sorted(processor.SUPPORTED_EXTENSIONS)),
        )

    file_id = str(uuid.uuid4())

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
                raise HTTPException(413, "File too large (max 500 MB).")
            tmp.write(chunk)

    try:
        # Convert to GLB
        glb_path = processor.convert(tmp_path, filename, GLB_DIR, file_id)

        # Extract annotations & assembly tree
        info = extractor.extract(tmp_path, filename)

    except ValueError as e:
        raise HTTPException(415, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(500, f"Processing failed: {e}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return ProcessedFile(
        file_id=file_id,
        gltf_url=f"/api/files/{file_id}.glb",
        metadata=info["metadata"],
        assembly=info["assembly"],
        annotations=info["annotations"],
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
