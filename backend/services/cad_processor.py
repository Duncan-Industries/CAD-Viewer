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
from pathlib import Path

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


def _has_cadquery() -> bool:
    try:
        import cadquery  # noqa: F401
        return True
    except ImportError:
        return False


def _step_iges_to_stl(input_path: str, output_stl: str, ext: str) -> None:
    """Use cadquery to tessellate a STEP or IGES file into STL."""
    import cadquery as cq

    if ext in (".step", ".stp"):
        result = cq.importers.importStep(input_path)
    else:
        result = cq.importers.importIges(input_path)

    # Export to STL
    cq.exporters.export(result, output_stl)


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


def convert(input_path: str, filename: str, output_dir: str, file_id: str) -> str:
    """
    Convert `input_path` to a GLB file at `output_dir/<file_id>.glb`.
    Returns the path to the GLB file.
    Raises ValueError for unsupported formats.
    """
    ext = Path(filename).suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file format '{ext}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    os.makedirs(output_dir, exist_ok=True)
    glb_path = os.path.join(output_dir, f"{file_id}.glb")

    # GLTF/GLB — copy directly; no conversion needed
    if ext in (".glb",):
        shutil.copy2(input_path, glb_path)
        return glb_path

    if ext in (".gltf",):
        # trimesh handles GLTF → GLB packing
        _direct_to_glb(input_path, glb_path)
        return glb_path

    # STEP / IGES — need OCC tessellation
    if ext in (".step", ".stp", ".iges", ".igs"):
        if not _has_cadquery():
            raise RuntimeError(
                "cadquery is required for STEP/IGES conversion but is not installed."
            )
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
            tmp_stl = tmp.name
        try:
            _step_iges_to_stl(input_path, tmp_stl, ext)
            _stl_to_glb(tmp_stl, glb_path)
        finally:
            if os.path.exists(tmp_stl):
                os.unlink(tmp_stl)
        return glb_path

    # All other mesh formats — trimesh direct conversion
    _direct_to_glb(input_path, glb_path)
    return glb_path
