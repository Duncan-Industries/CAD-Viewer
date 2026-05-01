"""
Converts CAD files to GLTF/GLB for Three.js consumption.

Conversion pipeline:
  STEP/IGES  →  cadquery (OCC tessellation)  →  STL  →  trimesh  →  GLB
  STL/OBJ    →  trimesh  →  GLB
  GLTF/GLB   →  pass-through
  FBX/3DS    →  trimesh  →  GLB (if trimesh plugin available)

The output is always a binary GLB written to `output_dir/<file_id>.glb`.
"""

import os
import tempfile
import shutil
import hashlib
from pathlib import Path
from typing import Any

import trimesh


SUPPORTED_EXTENSIONS = {
    ".step", ".stp",    # STEP
    ".iges", ".igs",    # IGES
    ".stl",             # STL
    ".obj",             # OBJ
    ".gltf", ".glb",    # GLTF (pass-through)
    ".3mf",             # 3MF
    ".off",             # OFF mesh
    ".ply",             # PLY
}

PIPELINE_VERSION = "2"
QUALITY_PROFILES = {
    "fast": {"tolerance": 0.6, "angular_tolerance": 0.9},
    "balanced": {"tolerance": 0.2, "angular_tolerance": 0.5},
    "high": {"tolerance": 0.06, "angular_tolerance": 0.2},
}


def _has_cadquery() -> bool:
    try:
        import cadquery  # noqa: F401
        return True
    except ImportError:
        return False


def _get_quality_profile() -> str:
    raw = os.environ.get("CAD_TESSELLATION_QUALITY", "balanced").strip().lower()
    return raw if raw in QUALITY_PROFILES else "balanced"


def _get_mesh_params(profile_name: str) -> dict[str, float]:
    return QUALITY_PROFILES.get(profile_name, QUALITY_PROFILES["balanced"])


def _file_hash(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as src:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _cache_key(input_path: str, ext: str, profile_name: str) -> str:
    payload = f"{PIPELINE_VERSION}:{ext}:{profile_name}:{_file_hash(input_path)}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _get_cache_paths(output_dir: str, cache_key: str, file_id: str) -> tuple[str, str]:
    cache_dir = os.path.join(output_dir, "_cache")
    os.makedirs(cache_dir, exist_ok=True)
    cached_glb = os.path.join(cache_dir, f"{cache_key}.glb")
    target_glb = os.path.join(output_dir, f"{file_id}.glb")
    return cached_glb, target_glb


def _copy_if_needed(source: str, target: str) -> None:
    if os.path.abspath(source) == os.path.abspath(target):
        return
    shutil.copy2(source, target)


def _step_iges_to_stl(input_path: str, output_stl: str, ext: str, profile_name: str) -> None:
    """Use cadquery to tessellate a STEP or IGES file into STL."""
    import cadquery as cq

    if ext in (".step", ".stp"):
        result = cq.importers.importStep(input_path)
    else:
        result = cq.importers.importIges(input_path)

    mesh_params = _get_mesh_params(profile_name)
    # Lower tolerance produces denser meshes; profile trades fidelity for speed.
    cq.exporters.export(
        result,
        output_stl,
        tolerance=mesh_params["tolerance"],
        angularTolerance=mesh_params["angular_tolerance"],
    )


def _stl_to_glb(stl_path: str, glb_path: str) -> None:
    """Load an STL with trimesh and export as GLB."""
    mesh = trimesh.load(stl_path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        scene = mesh
    else:
        scene = trimesh.Scene(mesh)
    scene.export(glb_path, file_type="glb")


def _direct_to_glb(input_path: str, glb_path: str) -> None:
    """Convert directly with trimesh (OBJ, PLY, OFF, 3MF, GLTF, GLB, etc.)."""
    loaded = trimesh.load(input_path)
    if isinstance(loaded, trimesh.Scene):
        scene = loaded
    else:
        scene = trimesh.Scene(loaded)
    scene.export(glb_path, file_type="glb")


def convert(input_path: str, filename: str, output_dir: str, file_id: str) -> tuple[str, dict[str, Any]]:
    """
    Convert `input_path` to a GLB file at `output_dir/<file_id>.glb`.
    Returns the path to the GLB file and conversion diagnostics.
    Raises ValueError for unsupported formats.
    """
    ext = Path(filename).suffix.lower()
    profile_name = _get_quality_profile()

    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file format '{ext}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    os.makedirs(output_dir, exist_ok=True)
    cache_key = _cache_key(input_path, ext, profile_name)
    cached_glb, target_glb = _get_cache_paths(output_dir, cache_key, file_id)
    diagnostics: dict[str, Any] = {
        "cache_key": cache_key,
        "cache_hit": False,
        "quality_profile": profile_name,
        "warnings": [],
    }

    if os.path.exists(cached_glb):
        _copy_if_needed(cached_glb, target_glb)
        diagnostics["cache_hit"] = True
        return target_glb, diagnostics

    # GLTF/GLB — copy directly; no conversion needed
    if ext in (".glb",):
        _copy_if_needed(input_path, cached_glb)
        _copy_if_needed(cached_glb, target_glb)
        return target_glb, diagnostics

    if ext in (".gltf",):
        # trimesh handles GLTF → GLB packing
        _direct_to_glb(input_path, cached_glb)
        _copy_if_needed(cached_glb, target_glb)
        return target_glb, diagnostics

    # STEP / IGES — need OCC tessellation
    if ext in (".step", ".stp", ".iges", ".igs"):
        if not _has_cadquery():
            raise RuntimeError(
                "cadquery is required for STEP/IGES conversion but is not installed."
            )
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
            tmp_stl = tmp.name
        try:
            _step_iges_to_stl(input_path, tmp_stl, ext, profile_name)
            _stl_to_glb(tmp_stl, cached_glb)
        except Exception as cadquery_err:
            # Fallback path: some environments/files fail OCC tessellation;
            # try trimesh's direct loader before giving up.
            try:
                _direct_to_glb(input_path, cached_glb)
                diagnostics["warnings"].append(
                    f"cadquery tessellation fallback triggered: {cadquery_err}"
                )
            except Exception as trimesh_err:
                raise RuntimeError(
                    "Failed to convert STEP/IGES file. "
                    f"cadquery path error: {cadquery_err}; "
                    f"trimesh fallback error: {trimesh_err}"
                ) from trimesh_err
        finally:
            if os.path.exists(tmp_stl):
                os.unlink(tmp_stl)
        _copy_if_needed(cached_glb, target_glb)
        return target_glb, diagnostics

    # All other mesh formats — trimesh direct conversion
    _direct_to_glb(input_path, cached_glb)
    _copy_if_needed(cached_glb, target_glb)
    return target_glb, diagnostics
