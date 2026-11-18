"""
Extract PRC geometry from 3D PDFs (and standalone .prc) via nanoprc-py.

Pipeline: PDF/PRC → nanoprc-py tessellation → triangle mesh + PMI lines/text → GLB
"""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any

import numpy as np
import trimesh

from models.schemas import Annotation, AssemblyNode

# Matches nanoprc_py / OpenGL demo primitive type codes.
PRIM_TRIANGLES = 0
PRIM_TRIANGLE_FAN = 1
PRIM_TRIANGLE_STRIP = 2
PRIM_LINES = 3
PRIM_LINE_STRIP = 4
PRIM_LINE_LOOP = 5

TRIANGLE_MODES = {PRIM_TRIANGLES, PRIM_TRIANGLE_FAN, PRIM_TRIANGLE_STRIP}
LINE_MODES = {PRIM_LINES, PRIM_LINE_STRIP, PRIM_LINE_LOOP}

DEFAULT_DIFFUSE = (0.75, 0.75, 0.78)
DEFAULT_LINE_COLOR = (0.15, 0.55, 0.28)  # CAD-style dimension green
MAX_PMI_LINES = 12_000

# Dimension-like PMI text only — incidental digits in notes must stay "note".
_DIM_TEXT_RE = re.compile(
    r"(?:"
    r"[Ø⌀∅]\s*[\d]+(?:[.,]\d+)?"  # diameter
    r"|R\s*[\d]+(?:[.,]\d+)?"  # radius
    r"|[\d]+(?:[.,]\d+)?\s*(?:mm|cm|m|in|ft|\"|')\b"  # value + linear unit
    r"|[\d]+(?:[.,]\d+)?\s*(?:°|deg)\b"  # angle
    r"|[\d]+(?:[.,]\d+)?\s*[±]\s*[\d]"  # value ± tol
    r"|\[\s*[\d.+/-]"  # ISO tolerance class / bracket dims
    r")",
    re.IGNORECASE,
)


def _classify_annotation_type(text: str) -> str:
    """Notes are the default; only clear dimensional strings are dimensions."""
    cleaned = (text or "").strip()
    if not cleaned:
        return "note"
    # Long prose / multi-word callouts are notes even if they mention a size.
    if len(cleaned) > 48 and not re.search(r"[Ø⌀∅]|±|°", cleaned):
        return "note"
    return "dimension" if _DIM_TEXT_RE.search(cleaned) else "note"


def _has_nanoprc() -> bool:
    try:
        import nanoprc_py  # noqa: F401

        return True
    except ImportError:
        return False


def _require_nanoprc():
    try:
        import nanoprc_py
    except ImportError as exc:
        raise RuntimeError(
            "nanoprc-py is required for 3D PDF/PRC conversion but is not installed."
        ) from exc
    return nanoprc_py


def _new_id() -> str:
    return str(uuid.uuid4())[:8]


def _open_document(input_path: str):
    nanoprc_py = _require_nanoprc()
    ctx = nanoprc_py.Context()
    try:
        doc = ctx.open(input_path)
    except RuntimeError as exc:
        detail = str(exc).strip() or "unknown parse error"
        raise RuntimeError(f"Failed to open 3D PDF/PRC: {detail}") from exc
    if not getattr(doc, "is_open", True):
        raise RuntimeError("Failed to open 3D PDF/PRC: document handle is not valid.")
    return doc


def _ensure_model_tree(doc):
    """
    nanoprc-py requires prepare + create_model_tree before tessellation queries.
    Returns the root ModelNode.
    """
    try:
        doc.prepare_model_tree()
    except Exception as exc:
        raise RuntimeError(f"Failed to prepare PRC model tree: {exc}") from exc
    try:
        root = doc.create_model_tree()
    except Exception as exc:
        raise RuntimeError(f"Failed to create PRC model tree: {exc}") from exc
    if root is None:
        raise RuntimeError("Failed to create PRC model tree: empty root.")
    return root


def _expand_triangles(mode: int, indices: np.ndarray) -> list[tuple[int, int, int]]:
    """Expand TRIANGLES / STRIP / FAN index lists into triangle triples."""
    tris: list[tuple[int, int, int]] = []
    n = int(indices.size)
    if mode == PRIM_TRIANGLES:
        for i in range(0, n - 2, 3):
            tris.append((int(indices[i]), int(indices[i + 1]), int(indices[i + 2])))
    elif mode == PRIM_TRIANGLE_STRIP:
        for i in range(0, n - 2):
            a = int(indices[i])
            b = int(indices[i + 1])
            c = int(indices[i + 2])
            if i % 2 == 1:
                a, b = b, a
            tris.append((a, b, c))
    elif mode == PRIM_TRIANGLE_FAN:
        if n < 3:
            return tris
        base = int(indices[0])
        for i in range(1, n - 1):
            tris.append((base, int(indices[i]), int(indices[i + 1])))
    return tris


def _expand_line_segments(mode: int, indices: np.ndarray) -> list[tuple[int, int]]:
    """Expand LINES / LINE_STRIP / LINE_LOOP index lists into segment pairs."""
    segs: list[tuple[int, int]] = []
    n = int(indices.size)
    if n < 2:
        return segs
    if mode == PRIM_LINES:
        for i in range(0, n - 1, 2):
            segs.append((int(indices[i]), int(indices[i + 1])))
    elif mode == PRIM_LINE_STRIP:
        for i in range(0, n - 1):
            segs.append((int(indices[i]), int(indices[i + 1])))
    elif mode == PRIM_LINE_LOOP:
        for i in range(0, n - 1):
            segs.append((int(indices[i]), int(indices[i + 1])))
        segs.append((int(indices[n - 1]), int(indices[0])))
    return segs


def _is_degenerate(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> bool:
    cross = np.cross(p1 - p0, p2 - p0)
    return float(np.linalg.norm(cross)) < 1e-12


def _extract_diffuse(material: Any) -> tuple[float, float, float]:
    """Best-effort diffuse RGB from nanoprc face_material payload."""
    if not material or not isinstance(material, dict):
        return DEFAULT_DIFFUSE
    if not material.get("is_material", True):
        return DEFAULT_DIFFUSE

    mat = material.get("material") if isinstance(material.get("material"), dict) else material
    diffuse = mat.get("diffuse") if isinstance(mat, dict) else None
    if diffuse is None and isinstance(material, dict):
        diffuse = material.get("diffuse")
    if diffuse is None or len(diffuse) < 3:
        return DEFAULT_DIFFUSE

    try:
        r, g, b = float(diffuse[0]), float(diffuse[1]), float(diffuse[2])
        if max(r, g, b) > 1.0:
            r, g, b = r / 255.0, g / 255.0, b / 255.0
        return (
            max(0.0, min(1.0, r)),
            max(0.0, min(1.0, g)),
            max(0.0, min(1.0, b)),
        )
    except (TypeError, ValueError, IndexError):
        return DEFAULT_DIFFUSE


def _colored_mesh(
    verts: np.ndarray,
    faces: list[list[int]],
    color: tuple[float, float, float],
) -> trimesh.Trimesh | None:
    if not faces:
        return None
    mesh = trimesh.Trimesh(
        vertices=verts.copy(),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    rgba = np.array(
        [[int(color[0] * 255), int(color[1] * 255), int(color[2] * 255), 255]],
        dtype=np.uint8,
    )
    mesh.visual.face_colors = np.repeat(rgba, len(faces), axis=0)
    return mesh


def _iter_primitives(doc, tess_index: int, face_index: int, known_count: int | None):
    """Yield graphics primitives for a face (or wire face_index=0)."""
    if known_count is not None:
        for primitive_index in range(known_count):
            try:
                primitive = doc.get_graphics_primitive(tess_index, face_index, primitive_index)
            except Exception:
                break
            if isinstance(primitive, dict):
                yield primitive
        return

    # Wire / markup tessellations often report 0 faces; probe until failure.
    for primitive_index in range(10_000):
        try:
            primitive = doc.get_graphics_primitive(tess_index, face_index, primitive_index)
        except Exception:
            break
        if not isinstance(primitive, dict):
            break
        yield primitive


def _collect_face_geometry(
    doc,
    tess_index: int,
    face_index: int,
    verts: np.ndarray,
    color: tuple[float, float, float],
    known_count: int | None,
    *,
    include_triangles: bool = True,
) -> tuple[trimesh.Trimesh | None, list[tuple[np.ndarray, np.ndarray, tuple[float, float, float]]]]:
    """Return (triangle mesh, line segments) for one face / wire buffer."""
    nverts = verts.shape[0]
    face_tris: list[list[int]] = []
    segments: list[tuple[np.ndarray, np.ndarray, tuple[float, float, float]]] = []

    for primitive in _iter_primitives(doc, tess_index, face_index, known_count):
        mode = int(primitive.get("type", -1))
        indices = np.asarray(primitive.get("indices", []), dtype=np.int64)
        if indices.size == 0:
            continue

        if include_triangles and mode in TRIANGLE_MODES:
            for a, b, c in _expand_triangles(mode, indices):
                if a < 0 or b < 0 or c < 0 or a >= nverts or b >= nverts or c >= nverts:
                    continue
                if a == b or b == c or a == c:
                    continue
                if _is_degenerate(verts[a], verts[b], verts[c]):
                    continue
                face_tris.append([a, b, c])
        elif mode in LINE_MODES:
            for a, b in _expand_line_segments(mode, indices):
                if a < 0 or b < 0 or a >= nverts or b >= nverts or a == b:
                    continue
                p0 = verts[a]
                p1 = verts[b]
                if float(np.linalg.norm(p1 - p0)) < 1e-12:
                    continue
                segments.append((p0.copy(), p1.copy(), color))

    return _colored_mesh(verts, face_tris, color), segments


def _tess_is_markup_or_text(doc, tess_index: int) -> bool:
    """
    Markup tessellations often include glyph triangle meshes that look like black
    blobs. Prefer HTML/text labels + leader lines instead of baking glyphs into GLB.
    """
    try:
        if int(doc.number_of_text_primitives(tess_index)) > 0:
            return True
    except Exception:
        pass
    try:
        info = doc.tessellation_info(tess_index)
        if isinstance(info, dict):
            raw_mu = info.get("mark_up_index")
            if raw_mu is not None and int(raw_mu) >= 0:
                return True
            name = str(info.get("name") or "").lower()
            if "markup" in name or "pmi" in name or "dimension" in name or "note" in name:
                return True
    except Exception:
        pass
    return False


def _collect_geometry(
    doc,
) -> tuple[
    list[trimesh.Trimesh],
    list[tuple[np.ndarray, np.ndarray, tuple[float, float, float]]],
]:
    """
    Collect solid body triangle meshes + PMI leader line segments.

    Notes are text only (extracted separately as annotations). Markup/glyph
    triangle meshes are skipped so they are not misclassified as CAD bodies
    or as "notes".
    """
    tess_count, _line_count = doc.tessellation_counts()
    tess_count = int(tess_count)
    if tess_count <= 0:
        return [], []

    body_meshes: list[trimesh.Trimesh] = []
    segments: list[tuple[np.ndarray, np.ndarray, tuple[float, float, float]]] = []

    for tess_index in range(tess_count):
        is_markup = _tess_is_markup_or_text(doc, tess_index)
        # Notes are text primitives — never bake markup glyph/board triangles.
        include_triangles = not is_markup
        line_color = DEFAULT_LINE_COLOR if is_markup else DEFAULT_DIFFUSE
        num_faces = int(doc.number_of_faces(tess_index))

        if num_faces > 0:
            for face_index in range(num_faces):
                positions = np.asarray(
                    doc.face_vertex_positions(tess_index, face_index),
                    dtype=np.float64,
                )
                if positions.size == 0:
                    continue
                verts = positions.reshape((-1, 3))
                if verts.shape[0] < 2:
                    continue

                try:
                    primitive_count = int(doc.face_graphics_primitive_count(tess_index, face_index))
                except Exception:
                    primitive_count = 0
                if primitive_count <= 0:
                    continue

                try:
                    material = doc.face_material(tess_index, face_index)
                except Exception:
                    material = None
                color = DEFAULT_LINE_COLOR if is_markup else _extract_diffuse(material)

                mesh, face_segs = _collect_face_geometry(
                    doc,
                    tess_index,
                    face_index,
                    verts,
                    color,
                    primitive_count,
                    include_triangles=include_triangles,
                )
                if mesh is not None:
                    body_meshes.append(mesh)
                segments.extend(face_segs)
            continue

        # Face-less wire / markup: vertices live on the tessellation buffer.
        try:
            positions = np.asarray(doc.tessellation_vertex_positions(tess_index), dtype=np.float64)
        except Exception:
            continue
        if positions.size == 0:
            continue
        verts = positions.reshape((-1, 3))
        if verts.shape[0] < 2:
            continue

        mesh, face_segs = _collect_face_geometry(
            doc,
            tess_index,
            0,
            verts,
            line_color,
            None,
            include_triangles=include_triangles,
        )
        if mesh is not None:
            body_meshes.append(mesh)
        segments.extend(face_segs)

    return body_meshes, segments


def _segments_to_pmi_lines(
    segments: list[tuple[np.ndarray, np.ndarray, tuple[float, float, float]]],
) -> list[dict[str, Any]]:
    """Serialize leader/extension segments for thin client-side line rendering."""
    lines: list[dict[str, Any]] = []
    for p0, p1, _color in segments[:MAX_PMI_LINES]:
        lines.append(
            {
                "start": {"x": float(p0[0]), "y": float(p0[1]), "z": float(p0[2])},
                "end": {"x": float(p1[0]), "y": float(p1[1]), "z": float(p1[2])},
            }
        )
    return lines


def extract_text_annotations(doc) -> list[Annotation]:
    """Pull PMI note/dimension text primitives from every tessellation."""
    tess_count, _line_count = doc.tessellation_counts()
    tess_count = int(tess_count)
    annotations: list[Annotation] = []
    seen: set[str] = set()

    for tess_index in range(tess_count):
        try:
            text_count = int(doc.number_of_text_primitives(tess_index))
        except Exception:
            continue
        if text_count <= 0:
            continue

        tess_name = ""
        mark_up_index = None
        try:
            info = doc.tessellation_info(tess_index)
            if isinstance(info, dict):
                tess_name = str(info.get("name") or "").strip()
                raw_mu = info.get("mark_up_index")
                if raw_mu is not None and int(raw_mu) >= 0:
                    mark_up_index = int(raw_mu)
        except Exception:
            pass

        for text_index in range(text_count):
            try:
                prim = doc.get_text_primitive(tess_index, text_index)
            except Exception:
                continue
            if not isinstance(prim, dict):
                continue
            text = str(prim.get("text") or "").strip()
            if not text:
                continue

            origin = prim.get("origin")
            position = None
            if origin is not None and len(origin) >= 3:
                try:
                    position = {
                        "x": float(origin[0]),
                        "y": float(origin[1]),
                        "z": float(origin[2]),
                    }
                except (TypeError, ValueError, IndexError):
                    position = None

            dedupe_key = f"{text}|{position}"
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            # Notes are always text; only classify as dimension when the string
            # itself looks dimensional. mark_up_index alone is not enough —
            # PMI markups include general notes as well as dimensions.
            ann_type = _classify_annotation_type(text)

            annotations.append(
                Annotation(
                    id=_new_id(),
                    type=ann_type,
                    text=text,
                    component=tess_name or None,
                    position=position,
                    metadata={
                        "source": "prc_text_primitive",
                        "tess_index": tess_index,
                        "text_index": text_index,
                        "mark_up_index": mark_up_index,
                        "text_height": prim.get("text_height"),
                        "text_width": prim.get("text_width"),
                    },
                )
            )

    return annotations


def pdf_prc_to_glb(input_path: str, glb_path: str) -> dict[str, Any]:
    """
    Convert a PRC-embedded 3D PDF (or standalone .prc) to GLB.

    Solid/surface triangles go into the GLB. Dimension leader lines are returned
    as `pmi_lines` for thin client-side rendering (tube meshes looked like grey
    rectangles in the viewer).
    """
    doc = _open_document(input_path)
    # Model tree must exist before tessellation_counts / face queries.
    _ensure_model_tree(doc)

    meshes_body, segments = _collect_geometry(doc)
    text_annotations = extract_text_annotations(doc)
    pmi_lines = _segments_to_pmi_lines(segments)

    if not meshes_body:
        raise ValueError(
            "No PRC mesh found — U3D-only PDFs are not supported, "
            "or this file has no surface tessellation."
        )

    scene = trimesh.Scene()
    for i, mesh in enumerate(meshes_body):
        name = f"__body_{i}__"
        scene.add_geometry(mesh, node_name=name, geom_name=name)

    scene.export(glb_path, file_type="glb")

    # Sidecar so cache hits can still restore thin PMI leaders.
    sidecar = f"{os.path.splitext(glb_path)[0]}.pmi.json"
    try:
        with open(sidecar, "w", encoding="utf-8") as fh:
            json.dump({"pmi_lines": pmi_lines}, fh)
    except Exception:
        sidecar = ""

    tri_count = int(sum(len(m.faces) for m in meshes_body))
    tess_n, line_n = doc.tessellation_counts()
    return {
        "tessellations": int(tess_n),
        "line_tessellations": int(line_n),
        "mesh_parts": len(meshes_body),
        "body_parts": len(meshes_body),
        "note_parts": 0,
        "triangles": tri_count,
        "line_segments": len(segments),
        "pmi_lines": pmi_lines,
        "pmi_sidecar": sidecar,
        "text_primitives": len(text_annotations),
        "views": int(getattr(doc, "number_of_views", 0) or 0),
    }


def _map_model_node(node) -> AssemblyNode:
    children_raw = []
    try:
        children_raw = list(node.children())
    except Exception:
        children_raw = []

    name = (getattr(node, "name", None) or "").strip() or "Unnamed"
    has_children = len(children_raw) > 0
    is_model = bool(getattr(node, "is_model", False))
    node_type = "assembly" if (has_children or is_model) else "part"

    mapped = AssemblyNode(
        id=_new_id(),
        name=name,
        type=node_type,
        color=None,
        children=[],
    )
    for child in children_raw:
        mapped.children.append(_map_model_node(child))
    return mapped


def extract_prc_assembly(doc, root=None) -> list[AssemblyNode]:
    """Map nanoprc model tree roots into AssemblyNode list for the UI."""
    if root is None:
        try:
            root = _ensure_model_tree(doc)
        except Exception:
            return []

    children = []
    try:
        children = list(root.children())
    except Exception:
        children = []

    # Prefer listing children of the synthetic root; fall back to the root itself.
    if children:
        return [_map_model_node(child) for child in children]
    return [_map_model_node(root)]


def open_and_extract_assembly(input_path: str) -> list[AssemblyNode]:
    """Open a file and return its PRC assembly tree."""
    doc = _open_document(input_path)
    return extract_prc_assembly(doc)


def open_and_summarize(input_path: str) -> dict[str, Any]:
    """Open a file and return view/tessellation summary + PMI text annotations."""
    doc = _open_document(input_path)
    root = _ensure_model_tree(doc)
    tess_n, line_n = doc.tessellation_counts()
    views = int(getattr(doc, "number_of_views", 0) or 0)
    assembly = extract_prc_assembly(doc, root=root)
    text_annotations = extract_text_annotations(doc)
    return {
        "views": views,
        "tessellations": int(tess_n),
        "line_tessellations": int(line_n),
        "assembly": assembly,
        "annotations": text_annotations,
    }
