"""
Extracts annotations, assembly trees, and metadata from CAD files.
Supports STEP (AP203/AP214/AP242), IGES, and GLTF extras.
"""

import os
import uuid
import re
from typing import Any

from models.schemas import Annotation, AssemblyNode, ColorRGB, FileMetadata


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _new_id() -> str:
    return str(uuid.uuid4())[:8]


def _safe_occ_import():
    """Try importing OCC modules bundled with cadquery."""
    try:
        from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
        from OCC.Core.XCAFApp import XCAFApp_Application
        from OCC.Core.TDocStd import TDocStd_Document
        from OCC.Core.TCollection import TCollection_ExtendedString
        from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
        from OCC.Core.TDF import TDF_LabelSequence
        from OCC.Core.TDataStd import TDataStd_Name
        from OCC.Core.Quantity import Quantity_Color, Quantity_TOC_RGB
        return True, {
            "STEPCAFControl_Reader": STEPCAFControl_Reader,
            "XCAFApp_Application": XCAFApp_Application,
            "TDocStd_Document": TDocStd_Document,
            "TCollection_ExtendedString": TCollection_ExtendedString,
            "XCAFDoc_DocumentTool": XCAFDoc_DocumentTool,
            "TDF_LabelSequence": TDF_LabelSequence,
            "TDataStd_Name": TDataStd_Name,
            "Quantity_Color": Quantity_Color,
            "Quantity_TOC_RGB": Quantity_TOC_RGB,
        }
    except ImportError:
        return False, {}


# ---------------------------------------------------------------------------
# STEP annotation extraction
# ---------------------------------------------------------------------------

def _get_label_name(label, TDataStd_Name) -> str:
    name_attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID(), name_attr):
        raw = name_attr.Get().ToExtString()
        return raw.strip() if raw.strip() else f"Part_{label.Tag()}"
    return f"Part_{label.Tag()}"


def _get_label_color(label, color_tool, Quantity_Color, Quantity_TOC_RGB):
    color = Quantity_Color()
    # Try surface color first, then generic
    for color_type in [0, 1, 2]:  # XCAFDoc_ColorGen, XCAFDoc_ColorSurf, XCAFDoc_ColorCurv
        try:
            if color_tool.GetColor(label, color_type, color):
                return ColorRGB(r=color.Red(), g=color.Green(), b=color.Blue())
        except Exception:
            pass
    return None


def _process_label_tree(label, shape_tool, color_tool, occ, depth=0) -> AssemblyNode:
    name = _get_label_name(label, occ["TDataStd_Name"])
    color = _get_label_color(label, color_tool, occ["Quantity_Color"], occ["Quantity_TOC_RGB"])

    is_assembly = shape_tool.IsAssembly(label)
    is_free = shape_tool.IsFree(label)
    node_type = "assembly" if is_assembly else "part"

    node = AssemblyNode(
        id=_new_id(),
        name=name,
        type=node_type,
        color=color,
        children=[],
    )

    # Recurse into components
    children_labels = occ["TDF_LabelSequence"]()
    shape_tool.GetComponents(label, children_labels, False)

    for i in range(1, children_labels.Length() + 1):
        child = children_labels.Value(i)
        # Resolve reference
        ref_label = occ["TDF_LabelSequence"]()
        referred = child
        shape_tool.GetReferredShape(child, referred)
        child_node = _process_label_tree(referred, shape_tool, color_tool, occ, depth + 1)
        child_node.name = _get_label_name(child, occ["TDataStd_Name"]) or child_node.name
        node.children.append(child_node)

    return node


def _extract_step_header(filepath: str) -> dict:
    """Parse the STEP file header for author, org, description, AP standard."""
    meta: dict = {}
    try:
        with open(filepath, "r", errors="replace") as f:
            header_lines = []
            in_header = False
            for line in f:
                stripped = line.strip()
                if stripped.startswith("HEADER;"):
                    in_header = True
                if in_header:
                    header_lines.append(stripped)
                if stripped.startswith("ENDSEC;") and in_header:
                    break
        header_text = " ".join(header_lines)

        # FILE_DESCRIPTION
        desc_match = re.search(r"FILE_DESCRIPTION\s*\(\s*\('([^']*)'\)", header_text)
        if desc_match:
            meta["description"] = desc_match.group(1)

        # AP standard from implementation_level
        ap_match = re.search(r"'\s*(AP\d+[^']*)'", header_text)
        if ap_match:
            meta["ap_standard"] = ap_match.group(1).strip()

        # FILE_NAME
        fn_match = re.search(
            r"FILE_NAME\s*\(\s*'[^']*'\s*,\s*'([^']*)'\s*,\s*\(\s*'([^']*)'\s*\)\s*,\s*\(\s*'([^']*)'\s*\)",
            header_text,
        )
        if fn_match:
            meta["created"] = fn_match.group(1)
            meta["author"] = fn_match.group(2)
            meta["organization"] = fn_match.group(3)

    except Exception:
        pass
    return meta


def _extract_step_annotations_from_text(filepath: str) -> list[Annotation]:
    """
    Fallback: scan raw STEP text for DRAUGHTING_NOTE and DESCRIPTIVE_REPRESENTATION_ITEM
    entities which are commonly used for embedded notes.
    """
    annotations = []
    try:
        with open(filepath, "r", errors="replace") as f:
            content = f.read()

        # DESCRIPTIVE_REPRESENTATION_ITEM (notes/descriptions)
        for m in re.finditer(
            r"DESCRIPTIVE_REPRESENTATION_ITEM\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)",
            content,
        ):
            name, value = m.group(1).strip(), m.group(2).strip()
            if value and value not in ("", " "):
                annotations.append(
                    Annotation(
                        id=_new_id(),
                        type="note",
                        text=f"{name}: {value}" if name else value,
                        metadata={"entity": "DESCRIPTIVE_REPRESENTATION_ITEM"},
                    )
                )

        # DRAUGHTING_ANNOTATION_OCCURRENCE
        for m in re.finditer(
            r"DRAUGHTING_ANNOTATION_OCCURRENCE\s*\(\s*'([^']*)'",
            content,
        ):
            text = m.group(1).strip()
            if text:
                annotations.append(
                    Annotation(
                        id=_new_id(),
                        type="note",
                        text=text,
                        metadata={"entity": "DRAUGHTING_ANNOTATION"},
                    )
                )

        # PROPERTY_DEFINITION with notes
        for m in re.finditer(
            r"PROPERTY_DEFINITION\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*",
            content,
        ):
            name, desc = m.group(1).strip(), m.group(2).strip()
            if desc and desc not in ("", " ", "$"):
                annotations.append(
                    Annotation(
                        id=_new_id(),
                        type="note",
                        text=f"{name}: {desc}" if name else desc,
                        metadata={"entity": "PROPERTY_DEFINITION"},
                    )
                )

    except Exception:
        pass
    return annotations


def extract_step(filepath: str, filename: str, file_size: int) -> dict[str, Any]:
    header = _extract_step_header(filepath)
    text_annotations = _extract_step_annotations_from_text(filepath)

    metadata = FileMetadata(
        filename=filename,
        format="STEP",
        file_size=file_size,
        unit="mm",
        author=header.get("author"),
        organization=header.get("organization"),
        created=header.get("created"),
        description=header.get("description"),
        ap_standard=header.get("ap_standard"),
    )

    assembly: list[AssemblyNode] = []
    annotations: list[Annotation] = list(text_annotations)

    occ_available, occ = _safe_occ_import()
    if occ_available:
        try:
            app = occ["XCAFApp_Application"].GetApplication()
            doc = occ["TDocStd_Document"](occ["TCollection_ExtendedString"]("XmlOcaf"))
            app.NewDocument(occ["TCollection_ExtendedString"]("XmlOcaf"), doc)

            reader = occ["STEPCAFControl_Reader"]()
            reader.SetNameMode(True)
            reader.SetColorMode(True)
            reader.SetLayerMode(True)

            status = reader.ReadFile(filepath)
            if status == 1:  # IFSelect_RetDone
                reader.Transfer(doc)

                shape_tool = occ["XCAFDoc_DocumentTool"].ShapeTool(doc.Main())
                color_tool = occ["XCAFDoc_DocumentTool"].ColorTool(doc.Main())

                free_shapes = occ["TDF_LabelSequence"]()
                shape_tool.GetFreeShapes(free_shapes)

                for i in range(1, free_shapes.Length() + 1):
                    label = free_shapes.Value(i)
                    node = _process_label_tree(label, shape_tool, color_tool, occ)
                    assembly.append(node)
        except Exception as exc:
            # OCC processing failed — still return what we have
            print(f"[OCC] Assembly extraction failed: {exc}")

    return {
        "metadata": metadata,
        "assembly": assembly,
        "annotations": annotations,
    }


# ---------------------------------------------------------------------------
# IGES extraction
# ---------------------------------------------------------------------------

def extract_iges(filepath: str, filename: str, file_size: int) -> dict[str, Any]:
    """Extract metadata and notes from IGES files."""
    metadata = FileMetadata(
        filename=filename,
        format="IGES",
        file_size=file_size,
        unit="mm",
    )
    annotations: list[Annotation] = []
    assembly: list[AssemblyNode] = []

    try:
        with open(filepath, "r", errors="replace") as f:
            lines = f.readlines()

        # IGES global section is lines starting with 'G'
        global_params: list[str] = []
        for line in lines:
            if len(line) >= 73 and line[72] == "G":
                global_params.append(line[:72].strip())

        global_text = "".join(global_params)
        parts = global_text.split(",")

        if len(parts) > 4:
            metadata.author = parts[4].strip().strip(";")
        if len(parts) > 5:
            metadata.organization = parts[5].strip().strip(";")
        if len(parts) > 18:
            metadata.created = parts[18].strip().strip(";")

        # Type 212: General Note entities
        note_pattern = re.compile(r"212,\d+,\d+,\d+,\d+,([^;]+);")
        for m in note_pattern.finditer("".join(l[:72] for l in lines if len(l) >= 73 and l[72] in "PD")):
            text = m.group(1).strip()
            if text:
                annotations.append(
                    Annotation(
                        id=_new_id(),
                        type="note",
                        text=text,
                        metadata={"entity_type": 212},
                    )
                )

    except Exception as exc:
        print(f"[IGES] Extraction failed: {exc}")

    return {"metadata": metadata, "assembly": assembly, "annotations": annotations}


# ---------------------------------------------------------------------------
# STL / OBJ / GLTF extraction (minimal metadata)
# ---------------------------------------------------------------------------

def extract_generic(filepath: str, filename: str, file_size: int, fmt: str) -> dict[str, Any]:
    metadata = FileMetadata(
        filename=filename,
        format=fmt.upper(),
        file_size=file_size,
    )

    annotations: list[Annotation] = []

    if fmt.lower() == "obj":
        try:
            with open(filepath, "r", errors="replace") as f:
                for line in f:
                    if line.startswith("# "):
                        comment = line[2:].strip()
                        if comment:
                            annotations.append(
                                Annotation(
                                    id=_new_id(),
                                    type="note",
                                    text=comment,
                                    metadata={"source": "obj_comment"},
                                )
                            )
        except Exception:
            pass

    return {"metadata": metadata, "assembly": [], "annotations": annotations}


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

EXTRACTORS = {
    ".step": extract_step,
    ".stp": extract_step,
    ".iges": extract_iges,
    ".igs": extract_iges,
}


def extract(filepath: str, filename: str) -> dict[str, Any]:
    ext = os.path.splitext(filename)[1].lower()
    file_size = os.path.getsize(filepath)
    fmt = ext.lstrip(".")

    if ext in (".step", ".stp"):
        return extract_step(filepath, filename, file_size)
    elif ext in (".iges", ".igs"):
        return extract_iges(filepath, filename, file_size)
    else:
        return extract_generic(filepath, filename, file_size, fmt)
