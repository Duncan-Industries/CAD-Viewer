"""
Feature catalog and measurement utilities for converted GLB models.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import numpy as np
import trimesh


@dataclass
class PartGeometry:
    part_id: str
    part_name: str
    mesh: trimesh.Trimesh
    edges: np.ndarray
    vertices: np.ndarray
    face_normals: np.ndarray
    face_centers: np.ndarray


def _load_scene(glb_path: str) -> trimesh.Scene:
    loaded = trimesh.load(glb_path, force="scene")
    if isinstance(loaded, trimesh.Scene):
        return loaded
    return trimesh.Scene(loaded)


def _sanitize_name(name: str, fallback: str) -> str:
    clean = (name or "").strip()
    if not clean:
        clean = fallback
    return clean


def _stable_part_id(name: str) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")
    return f"part_{normalized or 'unnamed'}"


def _build_part_geometry(part_name: str, mesh: trimesh.Trimesh) -> PartGeometry:
    part_id = _stable_part_id(part_name)
    vertices = np.array(mesh.vertices)
    edges = np.array(mesh.edges_unique)
    face_normals = np.array(mesh.face_normals)
    face_centers = np.array(mesh.triangles_center)
    return PartGeometry(
        part_id=part_id,
        part_name=part_name,
        mesh=mesh,
        edges=edges,
        vertices=vertices,
        face_normals=face_normals,
        face_centers=face_centers,
    )


def _iter_part_geometries(glb_path: str) -> list[PartGeometry]:
    scene = _load_scene(glb_path)
    parts: list[PartGeometry] = []
    for node_name, geom_name in scene.graph.to_flattened().items():
        geom = scene.geometry.get(geom_name)
        if not isinstance(geom, trimesh.Trimesh):
            continue
        label = _sanitize_name(node_name, geom_name)
        parts.append(_build_part_geometry(label, geom))
    return parts


def _edge_features(part: PartGeometry) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for idx, edge in enumerate(part.edges):
        v0 = part.vertices[edge[0]]
        v1 = part.vertices[edge[1]]
        length = float(np.linalg.norm(v1 - v0))
        features.append(
            {
                "id": f"{part.part_id}:edge:{idx}",
                "label": f"Edge {idx + 1} ({length:.3f})",
                "kind": "edge",
                "length": length,
                "markers": [v0.tolist(), v1.tolist()],
                "edge_index": idx,
            }
        )
    return features


def _hole_features(part: PartGeometry) -> list[dict[str, Any]]:
    if part.vertices.size == 0:
        return []
    boundary_edges = part.mesh.edges_boundary
    if boundary_edges is None or len(boundary_edges) == 0:
        return []

    groups = trimesh.grouping.group_rows(np.sort(boundary_edges, axis=1), require_count=1)
    features: list[dict[str, Any]] = []
    for idx, group in enumerate(groups):
        edge_rows = boundary_edges[group]
        loop_vertex_ids = np.unique(edge_rows.reshape(-1))
        loop_points = part.vertices[loop_vertex_ids]
        if len(loop_points) < 6:
            continue
        centroid = loop_points.mean(axis=0)
        radii = np.linalg.norm(loop_points - centroid, axis=1)
        radius = float(np.median(radii))
        if radius <= 0:
            continue
        spread = float(np.std(radii) / max(radius, 1e-9))
        if spread > 0.18:
            continue
        diameter = radius * 2.0
        features.append(
            {
                "id": f"{part.part_id}:hole:{idx}",
                "label": f"Hole {idx + 1} (D={diameter:.3f})",
                "kind": "hole",
                "diameter": diameter,
                "center": centroid.tolist(),
                "markers": [centroid.tolist()],
            }
        )
    return features


def _planar_features(part: PartGeometry) -> list[dict[str, Any]]:
    if len(part.face_normals) == 0:
        return []
    rounded = np.round(part.face_normals, 2)
    unique_normals, inverse = np.unique(rounded, axis=0, return_inverse=True)
    features: list[dict[str, Any]] = []
    for idx, normal in enumerate(unique_normals):
        mask = inverse == idx
        if int(mask.sum()) < 8:
            continue
        centers = part.face_centers[mask]
        representative = centers.mean(axis=0)
        norm = np.linalg.norm(normal)
        if norm == 0:
            continue
        unit = normal / norm
        offset = float(np.dot(representative, unit))
        features.append(
            {
                "id": f"{part.part_id}:plane:{idx}",
                "label": f"Plane {idx + 1}",
                "kind": "plane",
                "normal": unit.tolist(),
                "offset": offset,
                "markers": [representative.tolist()],
            }
        )
    return features


def _select_part(parts: list[PartGeometry], part_id: str) -> PartGeometry:
    for part in parts:
        if part.part_id == part_id:
            return part
    raise ValueError(f"Unknown part_id '{part_id}'")


def _feature_index(features: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {f["id"]: f for f in features}


def _format_value(value: float, unit: str = "model-units") -> dict[str, Any]:
    return {"value": value, "unit": unit, "display": f"{value:.4f} {unit}"}


def build_feature_catalog(glb_path: str, file_id: str) -> dict[str, Any]:
    if not os.path.exists(glb_path):
        raise ValueError("GLB path does not exist")
    parts = _iter_part_geometries(glb_path)
    summaries: list[dict[str, Any]] = []
    for part in parts:
        edges = _edge_features(part)
        holes = _hole_features(part)
        planes = _planar_features(part)
        features = [
            *({"id": f["id"], "label": f["label"], "kind": f["kind"]} for f in edges[:40]),
            *({"id": f["id"], "label": f["label"], "kind": f["kind"]} for f in holes[:40]),
            *({"id": f["id"], "label": f["label"], "kind": f["kind"]} for f in planes[:40]),
        ]
        summaries.append(
            {
                "id": part.part_id,
                "name": part.part_name,
                "feature_counts": {
                    "edge": len(edges),
                    "hole": len(holes),
                    "plane": len(planes),
                },
                "features": features,
            }
        )
    return {"file_id": file_id, "parts": summaries}


def measure_feature(glb_path: str, file_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not os.path.exists(glb_path):
        raise ValueError("GLB path does not exist")
    measurement_type = payload["measurement_type"]
    part_id = payload["part_id"]
    feature_a_id = payload["feature_a"]
    feature_b_id = payload.get("feature_b")

    parts = _iter_part_geometries(glb_path)
    part = _select_part(parts, part_id)

    edges = _edge_features(part)
    holes = _hole_features(part)
    planes = _planar_features(part)
    idx = _feature_index([*edges, *holes, *planes])

    feature_a = idx.get(feature_a_id)
    if feature_a is None:
        raise ValueError(f"Unknown feature id '{feature_a_id}'")

    if measurement_type == "edge_length":
        if feature_a["kind"] != "edge":
            raise ValueError("edge_length requires an edge feature")
        return {
            "file_id": file_id,
            "measurement_type": measurement_type,
            "part_id": part_id,
            "feature_a": feature_a_id,
            "feature_b": None,
            "value": _format_value(float(feature_a["length"])),
            "markers": [{"x": p[0], "y": p[1], "z": p[2]} for p in feature_a["markers"]],
        }

    if measurement_type == "hole_diameter":
        if feature_a["kind"] != "hole":
            raise ValueError("hole_diameter requires a hole feature")
        center = feature_a["center"]
        return {
            "file_id": file_id,
            "measurement_type": measurement_type,
            "part_id": part_id,
            "feature_a": feature_a_id,
            "feature_b": None,
            "value": _format_value(float(feature_a["diameter"])),
            "markers": [{"x": center[0], "y": center[1], "z": center[2]}],
        }

    if measurement_type == "plane_distance":
        if not feature_b_id:
            raise ValueError("plane_distance requires feature_b")
        feature_b = idx.get(feature_b_id)
        if feature_b is None:
            raise ValueError(f"Unknown feature id '{feature_b_id}'")
        if feature_a["kind"] != "plane" or feature_b["kind"] != "plane":
            raise ValueError("plane_distance requires two plane features")
        n1 = np.array(feature_a["normal"])
        n2 = np.array(feature_b["normal"])
        alignment = float(np.dot(n1, n2))
        if abs(abs(alignment) - 1.0) > 0.1:
            raise ValueError("Selected planes are not parallel enough")
        dist = abs(float(feature_a["offset"]) - float(feature_b["offset"]))
        markers = [feature_a["markers"][0], feature_b["markers"][0]]
        return {
            "file_id": file_id,
            "measurement_type": measurement_type,
            "part_id": part_id,
            "feature_a": feature_a_id,
            "feature_b": feature_b_id,
            "value": _format_value(dist),
            "markers": [{"x": p[0], "y": p[1], "z": p[2]} for p in markers],
        }

    raise ValueError(
        "Unsupported measurement_type. Use one of: edge_length, hole_diameter, plane_distance."
    )
