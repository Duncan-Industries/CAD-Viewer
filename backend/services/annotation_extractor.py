"""
Extracts annotations, assembly trees, and metadata from CAD files.
Supports STEP (AP203/AP214/AP242), IGES, 3D PDF/PRC, and GLTF extras.
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
    Fallback: scan raw STEP text for draughting notes, dimensions, and
    descriptive representation items commonly used for embedded PMI.
    """
    annotations = []
    try:
        with open(filepath, "r", errors="replace") as f:
            content = f.read()

        def _add(ann_type: str, text: str, entity: str) -> None:
            text = text.strip()
            if not text or text in ("", " ", "$"):
                return
            annotations.append(
                Annotation(
                    id=_new_id(),
                    type=ann_type,
                    text=text,
                    metadata={"entity": entity},
                )
            )

        # DESCRIPTIVE_REPRESENTATION_ITEM (notes/descriptions)
        for m in re.finditer(
            r"DESCRIPTIVE_REPRESENTATION_ITEM\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)",
            content,
        ):
            name, value = m.group(1).strip(), m.group(2).strip()
            if value and value not in ("", " "):
                label = f"{name}: {value}" if name else value
                _add("note", label, "DESCRIPTIVE_REPRESENTATION_ITEM")

        # DRAUGHTING_ANNOTATION_OCCURRENCE
        for m in re.finditer(
            r"DRAUGHTING_ANNOTATION_OCCURRENCE\s*\(\s*'([^']*)'",
            content,
        ):
            _add("note", m.group(1), "DRAUGHTING_ANNOTATION")

        # PROPERTY_DEFINITION with notes
        for m in re.finditer(
            r"PROPERTY_DEFINITION\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*",
            content,
        ):
            name, desc = m.group(1).strip(), m.group(2).strip()
            if desc and desc not in ("", " ", "$"):
                label = f"{name}: {desc}" if name else desc
                _add("note", label, "PROPERTY_DEFINITION")

        # Common draughting note / dimension text carriers in AP214/AP242
        for m in re.finditer(
            r"DRAUGHTING_CALLOUT\s*\(\s*'([^']*)'",
            content,
        ):
            _add("note", m.group(1), "DRAUGHTING_CALLOUT")

        for m in re.finditer(
            r"(?:DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|ANGULAR_LOCATION|ANGULAR_SIZE)\s*\(\s*'([^']*)'",
            content,
        ):
            text = m.group(1).strip()
            if text:
                _add("dimension", text, "DIMENSION")

        for m in re.finditer(
            r"MEASURE_REPRESENTATION_ITEM\s*\(\s*'([^']*)'\s*,\s*(?:POSITIVE_)?LENGTH_MEASURE\s*\(\s*([-\d.Ee+]+)\s*\)",
            content,
        ):
            name, value = m.group(1).strip(), m.group(2).strip()
            label = f"{name}: {value}" if name else value
            _add("dimension", label, "MEASURE_REPRESENTATION_ITEM")

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
# 3D PDF / PRC extraction (nanoprc-py)
# ---------------------------------------------------------------------------

def extract_prc_pdf(filepath: str, filename: str, file_size: int) -> dict[str, Any]:
    """Extract metadata, assembly tree, and PMI notes/dimensions from PRC/3D PDF."""
    from services import prc_pdf_processor

    ext = os.path.splitext(filename)[1].lower()
    fmt = "3D PDF" if ext == ".pdf" else "PRC"

    metadata = FileMetadata(
        filename=filename,
        format=fmt,
        file_size=file_size,
        description="PRC tessellation (mesh view; exact B-Rep not extracted)",
    )
    annotations: list[Annotation] = []
    assembly: list[AssemblyNode] = []

    if not prc_pdf_processor._has_nanoprc():
        annotations.append(
            Annotation(
                id=_new_id(),
                type="note",
                text="nanoprc-py is not installed; assembly tree unavailable.",
                metadata={"source": "prc_pdf"},
            )
        )
        return {"metadata": metadata, "assembly": assembly, "annotations": annotations}

    try:
        summary = prc_pdf_processor.open_and_summarize(filepath)
        assembly = summary.get("assembly") or []
        views = int(summary.get("views") or 0)
        tess = int(summary.get("tessellations") or 0)
        line_tess = int(summary.get("line_tessellations") or 0)
        text_anns = summary.get("annotations") or []
        if isinstance(text_anns, list):
            annotations.extend(text_anns)
        annotations.append(
            Annotation(
                id=_new_id(),
                type="note",
                text=(
                    f"PRC content: {views} view(s), {tess} surface tessellation(s), "
                    f"{line_tess} line tessellation(s), {len(text_anns)} text primitive(s)."
                ),
                metadata={
                    "source": "prc_pdf",
                    "views": views,
                    "tessellations": tess,
                    "line_tessellations": line_tess,
                    "text_primitives": len(text_anns),
                },
            )
        )
    except Exception as exc:
        annotations.append(
            Annotation(
                id=_new_id(),
                type="note",
                text=f"Could not read PRC metadata: {exc}",
                metadata={"source": "prc_pdf", "error": str(exc)},
            )
        )

    return {"metadata": metadata, "assembly": assembly, "annotations": annotations}


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

EXTRACTORS = {
    ".step": extract_step,
    ".stp": extract_step,
    ".iges": extract_iges,
    ".igs": extract_iges,
    ".pdf": extract_prc_pdf,
    ".prc": extract_prc_pdf,
}


def extract(filepath: str, filename: str) -> dict[str, Any]:
    ext = os.path.splitext(filename)[1].lower()
    file_size = os.path.getsize(filepath)
    fmt = ext.lstrip(".")

    if ext in (".step", ".stp"):
        return extract_step(filepath, filename, file_size)
    elif ext in (".iges", ".igs"):
        return extract_iges(filepath, filename, file_size)
    elif ext in (".pdf", ".prc"):
        return extract_prc_pdf(filepath, filename, file_size)
    else:
        return extract_generic(filepath, filename, file_size, fmt)
