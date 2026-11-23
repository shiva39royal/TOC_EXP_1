"""Semantic CAD Component Extractor for Railway Layouts.

Identifies and correlates composite railway engineering components:
- Signals (Signal Heads, Bases, Aspects, Signal IDs, KM markers)
- Tracks & TINs (Track polylines, Track Circuits like 08T, TIN numbers like (N-20), Turnouts, Crossovers)
- RFID Tags (R-166, R-247, Tag symbols)
- Axle Counters (DP7B, DP2A, wheel sensor double-circles, detection points)
- Shunts (01HS, 60S, quadrant fan symbols, direction arrows)
- Point Machines / Switches (P12A, P12B)
- Level Crossing Gates (LC No. 22)
- Station & Template structures
"""
from __future__ import annotations

import logging
import math
import re
from pathlib import Path
from typing import Any

from ezdxf import bbox
from ezdxf.math import Matrix44

from app.services.cad.coordinate_transformer import CoordinateTransformer
from app.ontology.ontology_engine import RailwayOntology, clean_attribute_tag

log = logging.getLogger("cad.components")

CATEGORY_CONFIG = [
    {"id": 1, "key": "signals", "name": "Signals", "icon": "signal", "description": "Running signals, shunt signals, fog signals"},
    {"id": 2, "key": "tracks_tins", "name": "TINs & Track Circuits", "icon": "track", "description": "Track circuits (08T, C01T), turning TINs, crossovers (RFID-N/G)"},
    {"id": 3, "key": "rfid_tags", "name": "RFID Tags", "icon": "tag", "description": "Track-mounted RFID tags (R-100 series)"},
    {"id": 4, "key": "axle_counters", "name": "Axle Counters", "icon": "circle", "description": "Detection points (DP7B, DP2A, etc.)"},
    {"id": 5, "key": "shunts", "name": "Shunts", "icon": "shunt", "description": "Shunt signals and indicators (01HS, 60S)"},
    {"id": 6, "key": "points", "name": "Points & Turnouts", "icon": "point", "description": "Point machines and switch crossovers"},
    {"id": 7, "key": "gates", "name": "Level Crossing Gates", "icon": "gate", "description": "Interlocked LC gates and closures"},
    {"id": 8, "key": "templates", "name": "Station & Borders", "icon": "building", "description": "Station building, titles, and templates"},
]

CAT_BY_KEY = {c["key"]: c["id"] for c in CATEGORY_CONFIG}

ACI_PALETTE = {
    1: "#FF0000", 2: "#FFFF00", 3: "#00FF00", 4: "#00FFFF",
    5: "#FFFFFF", 6: "#FF00FF", 7: "#FFFFFF", 8: "#808080",
    9: "#C0C0C0", 30: "#FF8000", 40: "#FFA500", 140: "#007ACC"
}


def _color_hex(color_val: int) -> str:
    if color_val in ACI_PALETTE:
        return ACI_PALETTE[color_val]
    if color_val > 256:
        return f"#{color_val & 0xFFFFFF:06X}"
    return "#FFFFFF"


def clean_cad_text(text: str) -> str:
    """Normalizes raw CAD text strings, stripping DXF MTEXT formatting sequences."""
    if not text:
        return ""
    t = re.sub(r"\{[^\}]*\}", "", text)
    t = re.sub(r"\\[A-Za-z0-9]+;?", " ", t)
    return t.strip()


def clean_attribute_tag(tag: str) -> str:
    """Normalizes CAD attribute tags: removes trailing periods, colons, underscores, case-folds."""
    if not tag:
        return ""
    return re.sub(r"[\s\.\:\-_]+", "_", tag.strip().upper()).strip("_")


def classify_tags_and_name(name: str, tags: dict[str, str], layer: str, text: str = "") -> tuple[str, int]:
    """Dynamically classifies CAD entity using declarative domain ontology rules."""
    res = RailwayOntology.get_instance().classify(name=name, tags=tags, layer=layer, text=text)
    return res.category_key, res.category_id


def resolve_block_identity(entity: Any, doc: Any = None) -> tuple[str, list[tuple[str, str]]]:
    """Recursively resolves real block name and attributes if entity is inside an anonymous block (*U...).
    Uses CoordinateTransformer for cycle-safe hierarchy traversal.
    """
    doc = doc or getattr(entity, "doc", None)
    if entity.dxftype() != "INSERT":
        return getattr(entity.dxf, "name", ""), []
    raw_name = getattr(entity.dxf, "name", "")
    attribs: list[tuple[str, str]] = []

    for a in getattr(entity, "attribs", []):
        attribs.append((getattr(a.dxf, "tag", ""), getattr(a.dxf, "text", "")))

    if not doc:
        return raw_name, attribs

    res = CoordinateTransformer.resolve_block_hierarchy(entity, doc)
    inner_attribs = [(k, v) for k, v in res.attributes.items()]
    resolved_name = res.canonical_name

    # If resolved_name is still anonymous *U, infer semantic label from attributes using ontology
    if resolved_name.startswith("*U"):
        tag_dict = dict(inner_attribs)
        ont = RailwayOntology.get_instance()
        classif = ont.classify(name=resolved_name, tags=tag_dict)
        if classif.category_key == "axle_counters":
            resolved_name = "Axle Counter (DP)"
        elif classif.category_key == "rfid_tags":
            t_val = tag_dict.get("TYPE", "")
            resolved_name = f"RFID Direction ({t_val})" if t_val else "RFID Direction Arrow"
        elif classif.category_key == "signals":
            resolved_name = "Signal"
        elif classif.category_key == "shunts":
            resolved_name = "Shunt Signal"
        elif classif.category_key == "points":
            resolved_name = "Point Machine"
        elif classif.category_key == "gates":
            resolved_name = "Level Crossing Gate"

    return resolved_name, inner_attribs


def _insert_box_to_world(b: Any, insert: Any, xscale: float, yscale: float, rotation: float = 0.0) -> list[float]:
    """Transforms a local bounding box to absolute world coordinates using Matrix44."""
    if not hasattr(b, "extmin") or not hasattr(b, "extmax"):
        return [0.0, 0.0, 0.0, 0.0]
    local_box = [float(b.extmin.x), float(b.extmin.y), float(b.extmax.x), float(b.extmax.y)]
    rot_rad = math.radians(float(rotation))
    ins_x = float(insert[0])
    ins_y = float(insert[1])
    ins_z = float(insert[2]) if len(insert) > 2 else 0.0
    m = Matrix44.scale(float(xscale), float(yscale), 1.0) @ Matrix44.z_rotate(rot_rad) @ Matrix44.translate(ins_x, ins_y, ins_z)
    return CoordinateTransformer.transform_bbox(m, local_box)


def classify_entity(entity: Any, doc: Any = None) -> tuple[str, int, str]:
    """Returns (category_key, category_id, resolved_name) for an entity or block."""
    doc = doc or getattr(entity, "doc", None)
    dxftype = entity.dxftype()
    layer = getattr(entity.dxf, "layer", "") or ""
    raw_name = getattr(entity.dxf, "name", "") or ""
    text = getattr(entity.dxf, "text", "") if dxftype == "TEXT" else (getattr(entity, "text", "") or "")

    real_name = raw_name
    attribs: list[tuple[str, str]] = []
    if dxftype == "INSERT" and doc:
        real_name, attribs = resolve_block_identity(entity, doc)

    tags = dict(attribs)
    layer_low = layer.lower()
    name_low = real_name.lower()
    text_clean = text.strip()

    # 1. Axle Counters & Detection Points
    if any(k in name_low for k in ["axle", "dedt point", "dest point", "sest point", "bpac"]) or real_name == "AC" or "DP_NO" in tags or any(k in tags for k in ["BPAC_RIGHT", "BPAC_LEFT", "LSS_RIGHT"]):
        return "axle_counters", 4, real_name
    if any("DP" in str(v) for v in tags.values()) or any(k.startswith("DP") for k in tags):
        return "axle_counters", 4, real_name
    if re.match(r"^DP\d{1,2}[A-Z]?$", text_clean) or (text_clean.startswith("DP") and len(text_clean) <= 6):
        if dxftype in ("TEXT", "MTEXT"):
            return "templates", 8, f"Axle Counter Label ({text_clean})"
        return "axle_counters", 4, f"Axle Counter ({text_clean})"

    # 2. RFID Tags & Direction Arrows (Strict Rule: components starting with R- belong to RFID - TAGs)
    if (real_name.upper().startswith("R-") or text_clean.upper().startswith("R-") or
        "rfid" in name_low or "rfid" in layer_low or real_name.startswith("RFID") or
        "RFID_TAG_NO." in tags or (tags.get("TYPE") in ["N", "S", "G", "T", "L", "A", "X", "D"]) or
        re.match(r"^R[-_ ]?\d{2,4}$", text_clean, re.I)):
        return "rfid_tags", 3, real_name

    # Direction texts (N, S, etc.)
    if text_clean in ("N", "S") or (len(text_clean) == 1 and text_clean in "NSTGLAXD" and layer_low in ("0", "rfid", "sig", "signal")):
        return "rfid_tags", 3, f"Direction ({text_clean})"

    # KM Location markers (e.g. 32.110, 32.300, 31.020, 85.300)
    if re.match(r"^\d{1,3}\.\d{2,3}$", text_clean) or (text_clean.startswith("Km:") and len(text_clean) < 15):
        return "rfid_tags", 3, f"Location (Km {text_clean})"

    # 3. Shunts
    if any(k in name_low for k in ["shunt"]):
        if dxftype in ("TEXT", "MTEXT"):
            return "templates", 8, f"Shunt Label ({text_clean or real_name})"
        return "shunts", 5, real_name
    if (
        "shunt" in layer_low
        or re.match(r"^SH[-_ ]?\d+[A-Z]?$", text_clean, re.I)
        or re.match(r"^\d{2}HS$", text_clean)
        or re.match(r"^\d{2,3}S$", text_clean)
        or any(k in tags for k in ["SHUNT_NO", "SHUNT_NO.", "SH_NO", "SH_NO."])
    ):
        if dxftype in ("TEXT", "MTEXT"):
            return "templates", 8, f"Shunt Label ({text_clean or real_name})"
        return "shunts", 5, real_name

    # 4. Signals (Strict Rule: Signals must start with "S")
    is_signal_text = bool(re.match(r"^S\s*\d{1,4}[A-Z]*(?:/[A-Z0-9]+)?$", text_clean, re.I) or
                          re.match(r"^[CS]\d{1,4}[A-Z]?$", text_clean, re.I))
    is_signal_block = any(k in name_low for k in ["signal", "distant", "starter", "home", "auto inner", "advance starter",
                                                 "route indicator", "calling", "calling-on", "nom. sig", "rev. sig"])
    if is_signal_text or is_signal_block or "sig" in layer_low or "signal" in layer_low or "SIGNAL_NO" in tags or "SIGNAL_NAME" in tags:
        # Exclude station template, building, tracks, and non-signals
        if any(bad in text_clean.upper() for bad in ["STATION", "BUILDING", "COMM.", "LOC.", "KM:", "SCALE", "ENTRY", "EXIT", "S-S."]):
            return "templates", 8, f"Template ({text_clean})"
        if dxftype in ("TEXT", "MTEXT") and not is_signal_text:
            return "templates", 8, f"Signal Text ({text_clean})"
        return "signals", 1, real_name

    # 5. Points & Point Machines (Strict Rule: components starting with P- belong to points/pointers)
    if (real_name.upper().startswith("P-") or text_clean.upper().startswith("P-") or
        any(k in name_low for k in ["point", "point machine", "trap point", "switch"]) or "POINT_NO" in tags or "A_END_POINT_NO." in tags or
        "point" in layer_low or re.match(r"^P[-_ ]?\d{1,2}[A-Z]?$", text_clean, re.I)):
        return "points", 6, real_name

    # 6. LC Gates
    if "gate" in layer_low or "lc" in layer_low or "lc. no" in text_clean.lower() or "gate" in name_low:
        if dxftype in ("TEXT", "MTEXT"):
            return "templates", 8, real_name
        return "gates", 7, real_name

    # 7. Tracks & TINs & Turnouts / Crossovers
    if dxftype == "HATCH":
        if "rfid" in layer_low:
            return "rfid_tags", 3, "RFID Tag Hatch"
        if "template" in layer_low:
            return "templates", 8, "Template Hatch"
        if any(k in layer_low for k in ["point", "turnout", "crossover", "switch"]):
            return "tracks_tins", 2, "Turnout Crossover"
        return "tracks_tins", 2, "Track Fill Hatch"
    if "track" in layer_low or "tin" in layer_low or "track" in name_low or "TRACK_NO" in tags or "TIN_NO" in tags:
        return "tracks_tins", 2, real_name
    if re.match(r"^\d{2,3}[A-Z]+T?$", text_clean) or re.match(r"^\(N-\d+\)$", text_clean):
        return "tracks_tins", 2, real_name
    # 8. Line Labels, Templates, Station & Text Annotations
    if dxftype in ("TEXT", "MTEXT") and any(k in text_clean.upper() for k in ["MAIN LINE", "LOOP LINE", "ROAD"]):
        return "templates", 8, f"Line Label ({text_clean})"
    if any(k in text_clean.upper() for k in ["MAIN LINE", "LOOP LINE", "ROAD"]):
        return "tracks_tins", 2, real_name

    if dxftype == "DIMENSION":
        dim_txt = getattr(entity.dxf, "text", "") or ""
        return "templates", 8, f"Dimension ({dim_txt or 'Scale Bar'})"
    if "template" in layer_low or "logo" in name_low or "station" in text_clean.lower() or "title" in layer_low or "title" in name_low or "aespl" in text_clean.lower():
        return "templates", 8, real_name
    if dxftype in ("TEXT", "MTEXT") and text_clean:
        return "templates", 8, f"Annotation ({text_clean})"

    return "other", 0, real_name


def extract_components(doc: Any, dwg_path: Path | None = None) -> dict[str, Any]:
    """Extracts organized components, layer definitions, and category counts."""
    # 1. Build Layer Catalog
    layers_catalog = []
    layer_name_to_id: dict[str, int] = {}
    for idx, lyr in enumerate(doc.layers, start=1):
        c_code = getattr(lyr.dxf, "color", 7)
        c_hex = _color_hex(c_code)
        layer_name_to_id[lyr.dxf.name] = idx
        layers_catalog.append({
            "id": idx,
            "name": lyr.dxf.name,
            "color": c_hex,
            "isLocked": getattr(lyr.dxf, "locked", False),
            "isVisible": True,
            "count": 0
        })

    # 2. Iterate Model Space and aggregate components
    msp = doc.modelspace()
    components: list[dict[str, Any]] = []
    category_counts: dict[str, int] = {c["key"]: 0 for c in CATEGORY_CONFIG}
    disposition_counts = {
        "ASSIGNED_TO_COMPONENT": 0,
        "NATIVE_CAD_GEOMETRY": 0,
        "ANNOTATION": 0,
        "INTENTIONALLY_IGNORED_WITH_REASON": 0,
        "UNRESOLVED": 0,
    }

    def add_component(comp: dict[str, Any], disposition: str | None = None) -> None:
        if not disposition:
            cat = comp.get("category", "")
            name_str = str(comp.get("name", "")).lower()
            if cat in ("templates",) or "annotation" in name_str or "label" in name_str or "dimension" in name_str:
                disposition = "ANNOTATION"
            elif cat == "tracks_tins" or "line" in name_str or "track" in name_str or "crossover" in name_str:
                disposition = "NATIVE_CAD_GEOMETRY"
            else:
                disposition = "ASSIGNED_TO_COMPONENT"
        comp["disposition"] = disposition
        disposition_counts[disposition] = disposition_counts.get(disposition, 0) + 1
        components.append(comp)

    cache = bbox.Cache()

    # Pre-pass: resolve dynamic block coordinates for anonymous blocks placed at origin (0, 0)
    zero_origin_map: dict[str, dict[str, Any]] = {}
    for e in msp:
        if e.dxftype() != "INSERT":
            continue
        ix = float(getattr(e.dxf.insert, "x", 0.0))
        iy = float(getattr(e.dxf.insert, "y", 0.0))
        bname = getattr(e.dxf, "name", "")
        if abs(ix) < 0.1 and abs(iy) < 0.1 and bname.startswith("*U"):
            blk = doc.blocks.get(bname)
            if not blk:
                continue
            for be in blk:
                if be.dxftype() == "INSERT":
                    nested_bname = getattr(be.dxf, "name", "")
                    nested_blk = doc.blocks.get(nested_bname)
                    attdef_tags: dict[str, str] = {}
                    if nested_blk:
                        for nbe in nested_blk:
                            if nbe.dxftype() == "ATTDEF":
                                attdef_tags[getattr(nbe.dxf, "tag", "")] = getattr(nbe.dxf, "text", "")
                    outer_attribs = {a.dxf.tag: a.dxf.text for a in getattr(e, "attribs", [])}
                    inner_attribs = {a.dxf.tag: a.dxf.text for a in getattr(be, "attribs", [])}
                    merged_tags = {**attdef_tags, **outer_attribs, **inner_attribs}
                    nested_lyr = getattr(be.dxf, "layer", getattr(e.dxf, "layer", "0"))

                    b_be = bbox.extents([be], cache=cache)
                    if b_be.has_data:
                        bx = [float(b_be.extmin.x), float(b_be.extmin.y), float(b_be.extmax.x), float(b_be.extmax.y)]
                    else:
                        nx, ny = float(be.dxf.insert.x), float(be.dxf.insert.y)
                        bx = [nx - 10.0, ny - 10.0, nx + 10.0, ny + 10.0]
                    anc = [float(be.dxf.insert.x), float(be.dxf.insert.y)]

                    ckey, cid = classify_tags_and_name(nested_bname, merged_tags, nested_lyr)
                    h = getattr(e.dxf, "handle", "")
                    rot_e = float(getattr(e.dxf, "rotation", 0.0))
                    rot_be = float(getattr(be.dxf, "rotation", 0.0))
                    tot_rot = (rot_e + rot_be) % 360.0
                    xs_e = float(getattr(e.dxf, "xscale", 1.0))
                    xs_be = float(getattr(be.dxf, "xscale", 1.0))
                    ys_e = float(getattr(e.dxf, "yscale", 1.0))
                    ys_be = float(getattr(be.dxf, "yscale", 1.0))
                    zero_origin_map[h] = {
                        "cat_key": ckey,
                        "cat_id": cid,
                        "real_name": nested_bname if not nested_bname.startswith("*U") else bname,
                        "anchor": anc,
                        "bbox": bx,
                        "tags": merged_tags,
                        "layer": nested_lyr,
                        "rotation": tot_rot,
                        "xscale": xs_e * xs_be,
                        "yscale": ys_e * ys_be,
                    }
                    break

    model_texts: list[tuple[str, float, float]] = []
    for me in msp:
        if me.dxftype() in ("TEXT", "MTEXT"):
            t_raw = clean_cad_text(str(getattr(me.dxf, "text", "") or getattr(me, "text", "") or ""))
            if t_raw and hasattr(me.dxf, "insert"):
                model_texts.append((t_raw, float(me.dxf.insert[0]), float(me.dxf.insert[1])))

    for e in msp:
        handle = getattr(e.dxf, "handle", "")
        dxftype = e.dxftype()

        if handle in zero_origin_map:
            resolved = zero_origin_map[handle]
            cat_key = resolved["cat_key"]
            cat_id = resolved["cat_id"]
            real_name = resolved["real_name"]
            lyr_name = resolved["layer"]
            anchor = resolved["anchor"]
            box = resolved["bbox"]
            tags = dict(resolved["tags"])
            center = anchor
            rot = float(resolved.get("rotation", 0.0) or 0.0)
            xs = float(resolved.get("xscale", 1.0) or 1.0)
            ys = float(resolved.get("yscale", 1.0) or 1.0)
        else:
            cat_key, cat_id, real_name = classify_entity(e, doc)
            lyr_name = getattr(e.dxf, "layer", "0")
            rot = float(getattr(e.dxf, "rotation", 0.0)) if hasattr(e, "dxf") else 0.0
            xs = float(getattr(e.dxf, "xscale", 1.0)) if hasattr(e, "dxf") else 1.0
            ys = float(getattr(e.dxf, "yscale", 1.0)) if hasattr(e, "dxf") else 1.0
            if lyr_name in layer_name_to_id:
                layers_catalog[layer_name_to_id[lyr_name] - 1]["count"] += 1

            if cat_key == "other":
                continue

            # Bounding Box and Center Anchor
            b = bbox.extents([e], cache=cache)
            if b.has_data:
                box = [float(b.extmin.x), float(b.extmin.y), float(b.extmax.x), float(b.extmax.y)]
                center = [(box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0]
            else:
                box = [0.0, 0.0, 0.0, 0.0]
                center = [0.0, 0.0]

            anchor = center
            if hasattr(e.dxf, "insert"):
                ins_x = float(e.dxf.insert[0])
                ins_y = float(e.dxf.insert[1])
                if box[0] - 25.0 <= ins_x <= box[2] + 25.0 and box[1] - 25.0 <= ins_y <= box[3] + 25.0:
                    anchor = [ins_x, ins_y]

            # Extract attributes/tags
            tags = {}
            if dxftype == "INSERT":
                _, inner_attribs = resolve_block_identity(e, doc)
                for k, v in inner_attribs:
                    if k and v:
                        tags[k] = v
                for a in getattr(e, "attribs", []):
                    tags[a.dxf.tag] = a.dxf.text
            elif dxftype in ("TEXT", "MTEXT"):
                t_val = e.dxf.text if dxftype == "TEXT" else e.text
                tags["TEXT"] = t_val
                if dxftype == "MTEXT":
                    ap = getattr(e.dxf, "attachment_point", 5)
                    tags["ATTACHMENT_POINT"] = ap
                    tags["CHAR_HEIGHT"] = getattr(e.dxf, "char_height", 2.5)
                    tags["ALIGN"] = "left" if ap in (1, 4, 7) else ("right" if ap in (3, 6, 9) else "center")
                if dxftype == "TEXT":
                    halign = getattr(e.dxf, "halign", 0)
                    valign = getattr(e.dxf, "valign", 0)
                    tags["HALIGN"] = halign
                    tags["ALIGN"] = "right" if halign == 2 else ("center" if halign in (1, 4) else "left")
                    if (halign != 0 or valign != 0) and hasattr(e.dxf, "align_point"):
                        ap = e.dxf.align_point
                        anchor = [float(ap[0]), float(ap[1])]
            elif dxftype == "DIMENSION":
                dim_txt = getattr(e.dxf, "text", "")
                tags["TEXT"] = dim_txt
                mid = getattr(e.dxf, "text_midpoint", None)
                if mid and hasattr(mid, "x"):
                    anchor = [float(mid.x), float(mid.y)]
                elif hasattr(e.dxf, "defpoint"):
                    anchor = [float(e.dxf.defpoint[0]), float(e.dxf.defpoint[1])]

        if handle in zero_origin_map and lyr_name in layer_name_to_id:
            layers_catalog[layer_name_to_id[lyr_name] - 1]["count"] += 1

        if cat_key == "other":
            if lyr_name.lower() in ("defpoints", "viewport") or dxftype in ("VIEWPORT", "DICTIONARY"):
                disposition_counts["INTENTIONALLY_IGNORED_WITH_REASON"] = disposition_counts.get("INTENTIONALLY_IGNORED_WITH_REASON", 0) + 1
            else:
                disposition_counts["UNRESOLVED"] = disposition_counts.get("UNRESOLVED", 0) + 1
            continue

        category_counts[cat_key] += 1

        text_clean = tags.get("TEXT", "").strip()

        # Dynamic association of signal heads with nearby modelspace text annotations
        if cat_key == "signals" or "CALLING" in real_name.upper():
            curr_sig = tags.get("SIGNAL_NO.", tags.get("SIGNAL_NO", ""))
            if "CALLING" in real_name.upper() and (not curr_sig or curr_sig.upper() in ("SA", "S", "CALLING")):
                nearby_c = [t for t, tx, ty in model_texts if re.match(r"^C\d{1,4}[A-Z]?$", t, re.I) and math.hypot(tx - anchor[0], ty - anchor[1]) <= 30.0]
                if nearby_c:
                    tags["SIGNAL_NO."] = nearby_c[0]
                    tags["SIGNAL_NO"] = nearby_c[0]
            elif not curr_sig or curr_sig.upper() in ("S", "SIG"):
                nearby_s = [t for t, tx, ty in model_texts if re.match(r"^S\d{1,4}[A-Z]?$", t, re.I) and math.hypot(tx - anchor[0], ty - anchor[1]) <= 30.0]
                if nearby_s:
                    tags["SIGNAL_NO."] = nearby_s[0]
                    tags["SIGNAL_NO"] = nearby_s[0]
            elif "SIGNAL BASE" in real_name.upper():
                nearby_any = [t for t, tx, ty in model_texts if re.match(r"^[SC]\d{1,4}[A-Z]?$", t, re.I) and math.hypot(tx - anchor[0], ty - anchor[1]) <= 45.0]
                if nearby_any:
                    tags["SIGNAL_NO."] = nearby_any[0]
                    tags["SIGNAL_NO"] = nearby_any[0]

        # Specific user-friendly display titles
        if cat_key == "tracks_tins" and dxftype == "INSERT" and doc:
            blk = doc.blocks.get(getattr(e.dxf, "name", ""))
            if blk:
                line_ents = [be for be in blk if be.dxftype() in ("LWPOLYLINE", "LINE", "POLYLINE")]
                tin_def = next((be for be in blk if be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "TIN_NO"), None)
                tc_def = next((be for be in blk if be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "TRACK_NO"), None)
                tin_val = tags.get("TIN_NO", "")
                tc_val = tags.get("TRACK_NO", "")

                # Search for actual instantiated ATTRIB entities on the INSERT
                attrib_by_tag = {getattr(a.dxf, "tag", "").upper(): a for a in getattr(e, "attribs", [])}
                tin_attr = attrib_by_tag.get("TIN_NO")
                tc_attr = attrib_by_tag.get("TRACK_NO")

                if line_ents and (tin_def or tc_def or tin_attr or tc_attr):
                    ins = e.dxf.insert
                    xs = float(getattr(e.dxf, "xscale", 1.0))
                    ys = float(getattr(e.dxf, "yscale", 1.0))
                    emitted = 0

                    # 1. Track Rail Line
                    b_line = bbox.extents(line_ents, cache=cache)
                    if b_line.has_data:
                        wb_line = _insert_box_to_world(b_line, ins, xs, ys)
                        anc_line = [(wb_line[0] + wb_line[2]) / 2.0, (wb_line[1] + wb_line[3]) / 2.0]
                        add_component({
                            "id": f"{handle}_line",
                            "category": cat_key,
                            "categoryId": cat_id,
                            "name": f"TINs & Track Circuits: Track Line ({tc_val or tin_val or real_name})",
                            "layer": lyr_name,
                            "layerId": layer_name_to_id.get(lyr_name, 0),
                            "color": _color_hex(getattr(e.dxf, "color", 7)),
                            "anchor": anc_line,
                            "bbox": wb_line,
                            "tags": {**tags, "TYPE": "TRACK_LINE"},
                            "grips": [anc_line, [wb_line[0], wb_line[1]], [wb_line[2], wb_line[1]], [wb_line[2], wb_line[3]], [wb_line[0], wb_line[3]]]
                        })
                        emitted += 1

                    # 2. Turning TIN Label (e.g. (N-16), (N-20))
                    if (tin_attr or tin_def) and tin_val:
                        wb_tin = None
                        if tin_attr:
                            b_tin_attr = bbox.extents([tin_attr], cache=cache)
                            if b_tin_attr.has_data:
                                wb_tin = [float(b_tin_attr.extmin.x), float(b_tin_attr.extmin.y),
                                          float(b_tin_attr.extmax.x), float(b_tin_attr.extmax.y)]
                        if wb_tin is None and tin_def:
                            b_tin = bbox.extents([tin_def], cache=cache)
                            if b_tin.has_data:
                                wb_tin = _insert_box_to_world(b_tin, ins, xs, ys)

                        if wb_tin:
                            anc_tin = [(wb_tin[0] + wb_tin[2]) / 2.0, (wb_tin[1] + wb_tin[3]) / 2.0]
                            # If default dummy template placeholder e.g. (N-), resolve from nearby authentic modelspace TEXT
                            if tin_val in ("(N-)", "N-", "()", "TIN") and doc:
                                for te in doc.modelspace():
                                    if te.dxftype() in ("TEXT", "MTEXT"):
                                        te_txt = (te.dxf.text if te.dxftype() == "TEXT" else getattr(te, "text", "")).strip()
                                        if re.match(r"^\(?N-\d+\)?$", te_txt):
                                            te_ins = getattr(te.dxf, "insert", None)
                                            if te_ins and abs(te_ins.y - anc_tin[1]) <= 6.0 and abs(te_ins.x - anc_tin[0]) <= 30.0:
                                                tin_val = te_txt
                                                anc_tin = [float(te_ins.x), float(te_ins.y)]
                                                b_te = bbox.extents([te], cache=cache)
                                                if b_te.has_data:
                                                    wb_tin = [float(b_te.extmin.x), float(b_te.extmin.y), float(b_te.extmax.x), float(b_te.extmax.y)]
                                                break

                            if tin_val not in ("(N-)", "N-", "()", "TIN"):
                                add_component({
                                    "id": f"{handle}_tin",
                                    "category": cat_key,
                                    "categoryId": cat_id,
                                    "name": f"TINs & Track Circuits: Turning TIN {tin_val}",
                                    "layer": lyr_name,
                                    "layerId": layer_name_to_id.get(lyr_name, 0),
                                    "color": "#FF0000",
                                    "anchor": anc_tin,
                                    "bbox": wb_tin,
                                    "tags": {**tags, "TEXT": tin_val, "TIN_NO": tin_val},
                                    "grips": [anc_tin, [wb_tin[0], wb_tin[1]], [wb_tin[2], wb_tin[1]], [wb_tin[2], wb_tin[3]], [wb_tin[0], wb_tin[3]]]
                                })
                                emitted += 1

                    # 3. Track Circuit Label (e.g. 05/06T, 08T)
                    if (tc_attr or tc_def) and tc_val and tc_val != "T":
                        wb_tc = None
                        if tc_attr:
                            b_tc_attr = bbox.extents([tc_attr], cache=cache)
                            if b_tc_attr.has_data:
                                wb_tc = [float(b_tc_attr.extmin.x), float(b_tc_attr.extmin.y),
                                         float(b_tc_attr.extmax.x), float(b_tc_attr.extmax.y)]
                        if wb_tc is None and tc_def:
                            b_tc = bbox.extents([tc_def], cache=cache)
                            if b_tc.has_data:
                                wb_tc = _insert_box_to_world(b_tc, ins, xs, ys)

                        if wb_tc:
                            anc_tc = [(wb_tc[0] + wb_tc[2]) / 2.0, (wb_tc[1] + wb_tc[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_tc",
                                "category": cat_key,
                                "categoryId": cat_id,
                                "name": f"TINs & Track Circuits: Track Circuit ({tc_val})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": _color_hex(getattr(e.dxf, "color", 7)),
                                "anchor": anc_tc,
                                "bbox": wb_tc,
                                "tags": {**tags, "TEXT": tc_val, "TRACK_NO": tc_val},
                                "grips": [anc_tc, [wb_tc[0], wb_tc[1]], [wb_tc[2], wb_tc[1]], [wb_tc[2], wb_tc[3]], [wb_tc[0], wb_tc[3]]]
                            })
                            emitted += 1

                    if emitted > 0:
                        category_counts[cat_key] += (emitted - 1)
                        continue

        if cat_key == "points" and dxftype == "INSERT" and doc:
            blk = doc.blocks.get(getattr(e.dxf, "name", ""))
            if blk:
                target_b = blk
                inner_ins = next((be for be in blk if be.dxftype() == "INSERT"), None)
                if inner_ins:
                    inner_b = doc.blocks.get(getattr(inner_ins.dxf, "name", ""))
                    if inner_b:
                        target_b = inner_b

                polys = [be for be in target_b if be.dxftype() in ("LWPOLYLINE", "LINE", "POLYLINE")]
                pt_attribs = list(getattr(e, "attribs", []))
                if inner_ins:
                    pt_attribs.extend(getattr(inner_ins, "attribs", []))

                pt_tags = {getattr(a.dxf, "tag", "").upper(): a for a in pt_attribs}
                pa_attr = pt_tags.get("A_END_POINT_NO.")
                pb_attr = pt_tags.get("B_END_POINT_NO.")
                pt_label_attr = pb_attr or pa_attr or pt_tags.get("POINT_NO")
                pt_val = getattr(pt_label_attr.dxf, "text", "") if pt_label_attr else tags.get("POINT_NO", "")

                if polys:
                    ins = e.dxf.insert
                    if inner_ins and hasattr(inner_ins.dxf, "insert"):
                        ins = (ins[0] + inner_ins.dxf.insert[0], ins[1] + inner_ins.dxf.insert[1])
                    xs = float(getattr(e.dxf, "xscale", 1.0))
                    ys = float(getattr(e.dxf, "yscale", 1.0))

                    # Check if crossover switch spanning End A and End B
                    pxs = [p[0] for be in polys for p in getattr(be, "vertices", lambda: [])()]
                    is_crossover = pxs and (max(pxs) - min(pxs) > 40.0)

                    emitted = 0
                    if is_crossover:
                        # Extract virtual entities to obtain true world bounds for each half
                        b_all = bbox.extents([e], cache=cache)
                        mid_x_world = (b_all.extmin.x + b_all.extmax.x) / 2.0 if b_all.has_data else 0.0

                        v_ents = []
                        try:
                            for ve in e.virtual_entities():
                                if ve.dxftype() == "INSERT":
                                    v_ents.extend(list(ve.virtual_entities()))
                                else:
                                    v_ents.append(ve)
                        except Exception:
                            v_ents = []

                        rail_prims = [vp for vp in v_ents if vp.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE")]
                        left_prims = []
                        right_prims = []
                        for vp in rail_prims:
                            bp = bbox.extents([vp], cache=cache)
                            if bp.has_data:
                                cx = (bp.extmin.x + bp.extmax.x) / 2.0
                                if cx <= mid_x_world:
                                    left_prims.append(vp)
                                else:
                                    right_prims.append(vp)

                        b_left = bbox.extents(left_prims, cache=cache) if left_prims else None
                        b_right = bbox.extents(right_prims, cache=cache) if right_prims else None

                        pa_val = getattr(pa_attr.dxf, "text", "") if pa_attr else (f"{pt_val} (End A)" if pt_val else "End A")
                        pb_val = getattr(pb_attr.dxf, "text", "") if pb_attr else (f"{pt_val} (End B)" if pt_val else "End B")

                        # Determine if Left is End B or End A
                        is_left_b = False
                        if pb_attr and b_all.has_data:
                            b_pb = bbox.extents([pb_attr], cache=cache)
                            if b_pb.has_data:
                                pbx = (b_pb.extmin.x + b_pb.extmax.x) / 2.0
                                is_left_b = (pbx <= mid_x_world)

                        b_ta = b_left if not is_left_b else b_right
                        b_tb = b_right if not is_left_b else b_left

                        # End A Turnout Track
                        if b_ta and b_ta.has_data:
                            wb_ta = [float(b_ta.extmin.x), float(b_ta.extmin.y), float(b_ta.extmax.x), float(b_ta.extmax.y)]
                            anc_ta = [(wb_ta[0] + wb_ta[2]) / 2.0, (wb_ta[1] + wb_ta[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_turnout_a",
                                "category": cat_key,
                                "categoryId": cat_id,
                                "name": f"Points & Turnouts: Turnout Track (End A - {pa_val})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": _color_hex(getattr(e.dxf, "color", 7)),
                                "anchor": anc_ta,
                                "bbox": wb_ta,
                                "tags": {**tags, "TYPE": "TURNOUT_TRACK", "POINT": pa_val, "END": "A"},
                                "grips": [anc_ta, [wb_ta[0], wb_ta[1]], [wb_ta[2], wb_ta[1]], [wb_ta[2], wb_ta[3]], [wb_ta[0], wb_ta[3]]]
                            })
                            emitted += 1

                        # End A Point Label
                        if pa_attr:
                            b_la = bbox.extents([pa_attr], cache=cache)
                            if b_la and b_la.has_data:
                                if abs(b_la.extmax.x) < 500.0 and abs(ins[0]) > 500.0:
                                    wb_la = _insert_box_to_world(b_la, ins, xs, ys)
                                else:
                                    wb_la = [float(b_la.extmin.x), float(b_la.extmin.y), float(b_la.extmax.x), float(b_la.extmax.y)]
                                anc_la = [(wb_la[0] + wb_la[2]) / 2.0, (wb_la[1] + wb_la[3]) / 2.0]
                                add_component({
                                    "id": f"{handle}_point_a",
                                    "category": cat_key,
                                    "categoryId": cat_id,
                                    "name": f"Points & Turnouts: Point Machine ({pa_val})",
                                    "layer": lyr_name,
                                    "layerId": layer_name_to_id.get(lyr_name, 0),
                                    "color": "#FFFFFF",
                                    "anchor": anc_la,
                                    "bbox": wb_la,
                                    "tags": {**tags, "TEXT": pa_val, "POINT_NO": pa_val, "POINT": pa_val, "A_END_POINT_NO.": pa_val},
                                    "grips": [anc_la, [wb_la[0], wb_la[1]], [wb_la[2], wb_la[1]], [wb_la[2], wb_la[3]], [wb_la[0], wb_la[3]]]
                                })
                                emitted += 1

                        # End B Turnout Track
                        if b_tb and b_tb.has_data:
                            wb_tb = [float(b_tb.extmin.x), float(b_tb.extmin.y), float(b_tb.extmax.x), float(b_tb.extmax.y)]
                            anc_tb = [(wb_tb[0] + wb_tb[2]) / 2.0, (wb_tb[1] + wb_tb[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_turnout_b",
                                "category": cat_key,
                                "categoryId": cat_id,
                                "name": f"Points & Turnouts: Turnout Track (End B - {pb_val})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": _color_hex(getattr(e.dxf, "color", 7)),
                                "anchor": anc_tb,
                                "bbox": wb_tb,
                                "tags": {**tags, "TYPE": "TURNOUT_TRACK", "POINT": pb_val, "END": "B"},
                                "grips": [anc_tb, [wb_tb[0], wb_tb[1]], [wb_tb[2], wb_tb[1]], [wb_tb[2], wb_tb[3]], [wb_tb[0], wb_tb[3]]]
                            })
                            emitted += 1

                        # End B Point Label
                        if pb_attr:
                            b_lb = bbox.extents([pb_attr], cache=cache)
                            if b_lb and b_lb.has_data:
                                if abs(b_lb.extmax.x) < 500.0 and abs(ins[0]) > 500.0:
                                    wb_lb = _insert_box_to_world(b_lb, ins, xs, ys)
                                else:
                                    wb_lb = [float(b_lb.extmin.x), float(b_lb.extmin.y), float(b_lb.extmax.x), float(b_lb.extmax.y)]
                                anc_lb = [(wb_lb[0] + wb_lb[2]) / 2.0, (wb_lb[1] + wb_lb[3]) / 2.0]
                                add_component({
                                    "id": f"{handle}_point_b",
                                    "category": cat_key,
                                    "categoryId": cat_id,
                                    "name": f"Points & Turnouts: Point Machine ({pb_val})",
                                    "layer": lyr_name,
                                    "layerId": layer_name_to_id.get(lyr_name, 0),
                                    "color": "#FFFFFF",
                                    "anchor": anc_lb,
                                    "bbox": wb_lb,
                                    "tags": {**tags, "TEXT": pb_val, "POINT_NO": pb_val, "POINT": pb_val, "B_END_POINT_NO.": pb_val},
                                    "grips": [anc_lb, [wb_lb[0], wb_lb[1]], [wb_lb[2], wb_lb[1]], [wb_lb[2], wb_lb[3]], [wb_lb[0], wb_lb[3]]]
                                })
                                emitted += 1

                    elif pt_label_attr:
                        # 1. Turnout Crossover Track Lines
                        b_turn = bbox.extents(polys, cache=cache)
                        if b_turn.has_data:
                            wb_turn = _insert_box_to_world(b_turn, ins, xs, ys)
                            anc_turn = [(wb_turn[0] + wb_turn[2]) / 2.0, (wb_turn[1] + wb_turn[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_turnout",
                                "category": cat_key,
                                "categoryId": cat_id,
                                "name": f"Points & Turnouts: Turnout Track ({pt_val or real_name})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": _color_hex(getattr(e.dxf, "color", 7)),
                                "anchor": anc_turn,
                                "bbox": wb_turn,
                                "tags": {**tags, "TYPE": "TURNOUT_TRACK", "POINT": pt_val},
                                "grips": [anc_turn, [wb_turn[0], wb_turn[1]], [wb_turn[2], wb_turn[1]], [wb_turn[2], wb_turn[3]], [wb_turn[0], wb_turn[3]]]
                            })
                            emitted += 1

                        # 2. Point Machine Label (e.g. P12B)
                        b_label = bbox.extents([pt_label_attr], cache=cache)
                        if b_label.has_data:
                            if (inner_ins and pt_label_attr in getattr(inner_ins, "attribs", [])) or (abs(b_label.extmax.x) < 500.0 and abs(ins[0]) > 500.0):
                                wb_label = _insert_box_to_world(b_label, ins, xs, ys)
                            else:
                                wb_label = [float(b_label.extmin.x), float(b_label.extmin.y),
                                            float(b_label.extmax.x), float(b_label.extmax.y)]
                            anc_label = [(wb_label[0] + wb_label[2]) / 2.0, (wb_label[1] + wb_label[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_point",
                                "category": cat_key,
                                "categoryId": cat_id,
                                "name": f"Points & Turnouts: Point Machine ({pt_val})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": "#FFFFFF",
                                "anchor": anc_label,
                                "bbox": wb_label,
                                "tags": {**tags, "TEXT": pt_val, "POINT_NO": pt_val, "POINT": pt_val},
                                "grips": [anc_label, [wb_label[0], wb_label[1]], [wb_label[2], wb_label[1]], [wb_label[2], wb_label[3]], [wb_label[0], wb_label[3]]]
                            })
                            emitted += 1

                    if emitted > 0:
                        category_counts[cat_key] += (emitted - 1)
                        continue

        if cat_key == "signals" and dxftype == "INSERT" and doc:
            blk = doc.blocks.get(getattr(e.dxf, "name", ""))
            if blk:
                target_b = blk
                inner_ins = next((be for be in blk if be.dxftype() == "INSERT"), None)
                if inner_ins:
                    inner_b = doc.blocks.get(getattr(inner_ins.dxf, "name", ""))
                    if inner_b:
                        target_b = inner_b

                has_fm = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "FM_NO." for be in target_b) or "FM_NO." in tags or "FM" in getattr(target_b, "name", "")
                has_loc = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "LOCATION_(M)" for be in target_b) or "LOCATION_(M)" in tags

                if has_fm and has_loc:
                    ins = e.dxf.insert
                    if inner_ins and hasattr(inner_ins.dxf, "insert"):
                        ins = (ins[0] + inner_ins.dxf.insert[0], ins[1] + inner_ins.dxf.insert[1])
                    xs = float(getattr(e.dxf, "xscale", 1.0))
                    ys = float(getattr(e.dxf, "yscale", 1.0))

                    attrib_by_tag = {getattr(a.dxf, "tag", "").upper(): a for a in getattr(e, "attribs", [])}
                    if inner_ins:
                        for a in getattr(inner_ins, "attribs", []):
                            attrib_by_tag[getattr(a.dxf, "tag", "").upper()] = a

                    loc_attr = attrib_by_tag.get("LOCATION_(M)")
                    fm_attr = attrib_by_tag.get("FM_NO.")
                    loc_val = getattr(loc_attr.dxf, "text", "") if loc_attr else tags.get("LOCATION_(M)", "")
                    fm_val = getattr(fm_attr.dxf, "text", "FM") if fm_attr else tags.get("FM_NO.", "FM")

                    emitted = 0
                    # 1. Location Marker text (e.g. 31.955)
                    if loc_attr:
                        b_loc = bbox.extents([loc_attr], cache=cache)
                        if b_loc.has_data:
                            wb_loc = [float(b_loc.extmin.x), float(b_loc.extmin.y), float(b_loc.extmax.x), float(b_loc.extmax.y)]
                            anc_loc = [(wb_loc[0] + wb_loc[2]) / 2.0, (wb_loc[1] + wb_loc[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_loc",
                                "category": cat_key,
                                "categoryId": cat_id,
                                "name": f"Signals: Location (Km {loc_val})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": "#FFFFFF",
                                "anchor": anc_loc,
                                "bbox": wb_loc,
                                "tags": {**tags, "LOCATION_(M)": loc_val, "TEXT": loc_val, "NAME": loc_val},
                                "grips": [anc_loc, [wb_loc[0], wb_loc[1]], [wb_loc[2], wb_loc[1]], [wb_loc[2], wb_loc[3]], [wb_loc[0], wb_loc[3]]]
                            })
                            emitted += 1

                    # 2. Fouling Mark (FM) Box & Clearance Limit (track layer marker)
                    fm_ents = [be for be in target_b if getattr(be.dxf, "tag", "") != "LOCATION_(M)"]
                    if fm_ents:
                        b_fm = bbox.extents(fm_ents, cache=cache)
                        if b_fm.has_data:
                            wb_fm = _insert_box_to_world(b_fm, ins, xs, ys)
                            anc_fm = [(wb_fm[0] + wb_fm[2]) / 2.0, (wb_fm[1] + wb_fm[3]) / 2.0]
                            add_component({
                                "id": f"{handle}_fm",
                                "category": "tracks_tins",
                                "categoryId": 2,
                                "name": f"Track Equipment: Fouling Mark ({fm_val})",
                                "layer": lyr_name,
                                "layerId": layer_name_to_id.get(lyr_name, 0),
                                "color": "#FFFFFF",
                                "anchor": anc_fm,
                                "bbox": wb_fm,
                                "tags": {**tags, "FM_NO.": fm_val, "TEXT": fm_val, "NAME": fm_val},
                                "grips": [anc_fm, [wb_fm[0], wb_fm[1]], [wb_fm[2], wb_fm[1]], [wb_fm[2], wb_fm[3]], [wb_fm[0], wb_fm[3]]]
                            })
                            emitted += 1

                    if emitted > 0:
                        category_counts[cat_key] += (emitted - 1)
                        continue

        if cat_key == "axle_counters":
            # Check if multi-head Axle Counter block to split into discrete heads
            if dxftype == "INSERT" and doc:
                blk = doc.blocks.get(getattr(e.dxf, "name", ""))
                if blk:
                    polys = [be for be in blk if be.dxftype() == "LWPOLYLINE"]
                    if polys:
                        min_px = min(min(p[0] for p in be.vertices()) for be in polys)
                        max_px = max(max(p[0] for p in be.vertices()) for be in polys)
                        if max_px - min_px > 50.0:
                            # Dual/multi-head Axle Counter block detected!
                            polys_0 = [be for be in polys if ((min(p[0] for p in be.vertices()) + max(p[0] for p in be.vertices())) / 2.0) < 50.0]
                            polys_1 = [be for be in polys if ((min(p[0] for p in be.vertices()) + max(p[0] for p in be.vertices())) / 2.0) >= 50.0]

                            ins = e.dxf.insert
                            xs = float(getattr(e.dxf, "xscale", 1.0))
                            ys = float(getattr(e.dxf, "yscale", 1.0))

                            heads = []
                            if polys_0:
                                b0 = bbox.extents(polys_0, cache=cache)
                                if b0.has_data:
                                    heads.append((0, _insert_box_to_world(b0, ins, xs, ys)))
                            if polys_1:
                                b1 = bbox.extents(polys_1, cache=cache)
                                if b1.has_data:
                                    heads.append((1, _insert_box_to_world(b1, ins, xs, ys)))

                            if len(heads) >= 2:
                                # Extract ordered DP attribute values directly from block attribs
                                dp_attrib_vals = [
                                    str(a.dxf.text).strip() for a in getattr(e, "attribs", [])
                                    if ("DP" in getattr(a.dxf, "tag", "").upper() or str(a.dxf.text).strip().startswith("DP") or "BPAC" in getattr(a.dxf, "tag", "").upper() or "BPAC" in str(a.dxf.text).strip())
                                    and str(a.dxf.text).strip()
                                ]
                                tr = tags.get("TRACK_NO", "")

                                for h_idx, h_box in heads:
                                    h_anchor = [(h_box[0] + h_box[2]) / 2.0, (h_box[1] + h_box[3]) / 2.0]
                                    h_grips = [
                                        h_anchor,
                                        [h_box[0], h_box[1]],
                                        [h_box[2], h_box[1]],
                                        [h_box[2], h_box[3]],
                                        [h_box[0], h_box[3]],
                                    ]
                                    if h_idx < len(dp_attrib_vals):
                                        dp_label = dp_attrib_vals[h_idx]
                                    else:
                                        # Look for nearby authentic modelspace CAD text (e.g. DP2A, DP2B)
                                        nearby_dp_txt = None
                                        if doc:
                                            for me in doc.modelspace():
                                                if me.dxftype() in ("TEXT", "MTEXT"):
                                                    mt = str(getattr(me.dxf, "text", "") or getattr(me, "text", "")).strip()
                                                    if re.match(r"^DP\d{1,2}[A-Z]?$", mt):
                                                        m_ins = getattr(me.dxf, "insert", None)
                                                        if m_ins and math.hypot(m_ins[0] - h_anchor[0], m_ins[1] - h_anchor[1]) <= 25.0:
                                                            nearby_dp_txt = mt
                                                            break
                                        dp_label = nearby_dp_txt or f"DP-{h_idx + 1}"

                                    h_title = f"Axle Counter ({dp_label}{' - ' + tr if tr else ''})"
                                    h_name = f"Axle Counters: {h_title}"

                                    category_counts[cat_key] += 1
                                    add_component({
                                        "id": f"{handle}_{h_idx}",
                                        "category": cat_key,
                                        "categoryId": cat_id,
                                        "name": h_name,
                                        "layer": lyr_name,
                                        "layerId": layer_name_to_id.get(lyr_name, 0),
                                        "color": _color_hex(getattr(e.dxf, "color", 7)),
                                        "anchor": h_anchor,
                                        "bbox": h_box,
                                        "tags": {**tags, "HEAD": str(h_idx + 1), "DP": dp_label, "DP_NO": dp_label},
                                        "grips": h_grips
                                    })

                                # Also emit Track Circuit text component if TRACK_NO attribute is present (e.g. 3423AC, 3323AC)
                                if tr and tr != "AC":
                                    tc_ins = None
                                    for a in getattr(e, "attribs", []):
                                        if getattr(a.dxf, "tag", "").upper() == "TRACK_NO":
                                            tc_ins = [round(float(a.dxf.insert[0]), 2), round(float(a.dxf.insert[1]), 2)]
                                            break
                                    if not tc_ins:
                                        tc_ins = [round((heads[0][1][0] + heads[-1][1][2]) / 2.0, 2), round(ins[1] + 4.28, 2)]
                                    add_component({
                                        "id": f"{handle}_track_circuit",
                                        "category": "templates",
                                        "categoryId": 8,
                                        "name": f"Track Circuit: {tr}",
                                        "layer": lyr_name,
                                        "layerId": layer_name_to_id.get(lyr_name, 0),
                                        "color": "#FFFFFF",
                                        "anchor": tc_ins,
                                        "bbox": [tc_ins[0] - 10, tc_ins[1] - 2, tc_ins[0] + 10, tc_ins[1] + 2],
                                        "tags": {**tags, "TEXT": tr, "NAME": tr, "TRACK_NO": tr},
                                        "grips": [tc_ins]
                                    })
                                    category_counts["templates"] += 1

                                # We added len(heads) components; earlier loop already added 1, so adjust by -1
                                category_counts[cat_key] -= 1
                                continue

        if cat_key == "rfid_tags" and dxftype == "INSERT" and doc:
            blk_name = getattr(e.dxf, "name", "")
            if any(k in blk_name.upper() for k in ["TURNOUT", "CROSSOVER", "POINT", "SWITCH"]) or any(k in lyr_name.lower() for k in ["point", "turnout", "crossover", "switch"]):
                continue

            blk = doc.blocks.get(blk_name)
            if blk:
                target_b = blk
                inner_ins = next((be for be in blk if be.dxftype() == "INSERT"), None)
                if inner_ins:
                    inner_b = doc.blocks.get(getattr(inner_ins.dxf, "name", ""))
                    if inner_b:
                        target_b = inner_b

                has_rf_tag = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "RFID_TAG_NO." for be in target_b)
                has_type = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "TYPE" for be in target_b)
                is_rfid = "rfid" in blk_name.lower() or "rfid" in getattr(target_b, "name", "").lower()

                if has_rf_tag or has_type or is_rfid:
                    ins = e.dxf.insert
                    if inner_ins and hasattr(inner_ins.dxf, "insert"):
                        ins = (ins[0] + inner_ins.dxf.insert[0], ins[1] + inner_ins.dxf.insert[1])
                    xs = float(getattr(e.dxf, "xscale", 1.0))
                    ys = float(getattr(e.dxf, "yscale", 1.0))

                    # Compute authentic net transform (rotation and horizontal mirroring)
                    rot_e = float(getattr(e.dxf, "rotation", 0.0))
                    rot_inner = float(getattr(inner_ins.dxf, "rotation", 0.0)) if inner_ins and hasattr(inner_ins.dxf, "rotation") else 0.0
                    tot_rot = (rot_e + rot_inner) % 360.0

                    xs_inner = float(getattr(inner_ins.dxf, "xscale", 1.0)) if inner_ins and hasattr(inner_ins.dxf, "xscale") else 1.0
                    tot_xs = xs * xs_inner

                    # In AutoCAD, standard RFID chevron triangle points right (at 0 deg, scale 1.0).
                    # A negative X-scale or rotation in (90, 270) mirrors it horizontally to point left.
                    is_flipped = (tot_xs < 0) ^ (90 < tot_rot < 270)
                    direction = "left" if is_flipped else "right"
                    sym = "<" if is_flipped else ">"
                    tags["DIRECTION"] = direction
                    tags["DIR_SYMBOL"] = sym

                    v_ents = []
                    if hasattr(e, "virtual_entities"):
                        def _collect_ves(ent):
                            ves = []
                            try:
                                for ve in ent.virtual_entities():
                                    if ve.dxftype() == "INSERT":
                                        ves.extend(_collect_ves(ve))
                                    else:
                                        ves.append(ve)
                            except Exception:
                                pass
                            return ves
                        v_ents = _collect_ves(e)

                    tag_vents = [ve for ve in v_ents if getattr(ve.dxf, "color", 0) == 6 or getattr(ve.dxf, "tag", "") == "RFID_TAG_NO."]
                    dir_vents = [ve for ve in v_ents if getattr(ve.dxf, "color", 0) != 6 and getattr(ve.dxf, "tag", "") != "RFID_TAG_NO."]

                    tag_ents = [be for be in target_b if getattr(be.dxf, "color", 0) == 6 or getattr(be.dxf, "tag", "") == "RFID_TAG_NO."]
                    dir_ents = [be for be in target_b if getattr(be.dxf, "color", 0) != 6 and getattr(be.dxf, "tag", "") != "RFID_TAG_NO."]

                    rf_no = tags.get("RFID_TAG_NO.", "")
                    typ = tags.get("TYPE", "")
                    loc = tags.get("LOCATION_(M)", "")

                    # Check for explicit CAD type annotation text (e.g. L, N, S, A, G, T) within tag bounds
                    if doc:
                        for me in doc.modelspace():
                            if me.dxftype() in ("TEXT", "MTEXT"):
                                m_txt = str(me.dxf.text if me.dxftype() == "TEXT" else me.text).strip().upper()
                                if m_txt in ("N", "S", "L", "A", "G", "T"):
                                    m_ins = getattr(me.dxf, "insert", None)
                                    if m_ins and math.hypot(ins[0] - m_ins[0], ins[1] - m_ins[1]) <= 12.0:
                                        typ = m_txt
                                        tags["TYPE"] = typ
                                        break

                    dir_label = f"{sym} {typ}".strip() or "Arrow"
                    tag_label = rf_no if (rf_no and rf_no != "R-") else "Tag"

                    emitted = 0
                    # 1. Direction Arrow (triangle / direction indicator on line)
                    wb_dir = None
                    if dir_vents:
                        b_dir = bbox.extents(dir_vents, cache=cache)
                        if b_dir.has_data:
                            wb_dir = [float(b_dir.extmin.x), float(b_dir.extmin.y), float(b_dir.extmax.x), float(b_dir.extmax.y)]
                    if wb_dir is None and dir_ents:
                        b_dir = bbox.extents(dir_ents, cache=cache)
                        if b_dir.has_data:
                            wb_dir = _insert_box_to_world(b_dir, ins, xs, ys)

                    if wb_dir is not None:
                        anc_dir = [(wb_dir[0] + wb_dir[2]) / 2.0, (wb_dir[1] + wb_dir[3]) / 2.0]
                        add_component({
                            "id": f"{handle}_dir",
                            "category": cat_key,
                            "categoryId": cat_id,
                            "name": f"RFID Tags: Direction ({dir_label})",
                            "layer": lyr_name,
                            "layerId": layer_name_to_id.get(lyr_name, 0),
                            "color": "#FFFFFF",
                            "anchor": anc_dir,
                            "bbox": wb_dir,
                            "tags": {**tags, "TYPE": typ, "TEXT": dir_label, "NAME": dir_label, "LOCATION_(M)": loc},
                            "grips": [anc_dir, [wb_dir[0], wb_dir[1]], [wb_dir[2], wb_dir[1]], [wb_dir[2], wb_dir[3]], [wb_dir[0], wb_dir[3]]]
                        })
                        emitted += 1

                    # 2. RFID Tag (magenta box + tag number)
                    wb_tag = None
                    if tag_vents:
                        b_tag = bbox.extents(tag_vents, cache=cache)
                        if b_tag.has_data:
                            wb_tag = [float(b_tag.extmin.x), float(b_tag.extmin.y), float(b_tag.extmax.x), float(b_tag.extmax.y)]
                    if wb_tag is None and tag_ents:
                        b_tag = bbox.extents(tag_ents, cache=cache)
                        if b_tag.has_data:
                            wb_tag = _insert_box_to_world(b_tag, ins, xs, ys)

                    if wb_tag is not None:
                        anc_tag = [(wb_tag[0] + wb_tag[2]) / 2.0, (wb_tag[1] + wb_tag[3]) / 2.0]
                        if (not rf_no or rf_no == "R-") and doc:
                            for me in doc.modelspace():
                                if me.dxftype() in ("TEXT", "MTEXT"):
                                    m_txt = me.dxf.text if me.dxftype() == "TEXT" else me.text
                                    m_match = re.search(r"\b(R-?(\d+))\b", m_txt, re.IGNORECASE)
                                    if m_match:
                                        m_ins = me.dxf.insert
                                        if math.hypot(anc_tag[0] - m_ins.x, anc_tag[1] - m_ins.y) <= 12.0:
                                            rf_no = f"R-{m_match.group(2)}"
                                            tags["RFID_TAG_NO."] = rf_no
                                            tag_label = rf_no
                                            break

                        tag_type_str = f" - Type {typ}" if typ else ""
                        add_component({
                            "id": f"{handle}_tag",
                            "category": cat_key,
                            "categoryId": cat_id,
                            "name": f"RFID Tags: RFID Tag ({tag_label}{tag_type_str})",
                            "layer": lyr_name,
                            "layerId": layer_name_to_id.get(lyr_name, 0),
                            "color": "#FF00FF",
                            "anchor": anc_tag,
                            "bbox": wb_tag,
                            "tags": {**tags, "RFID_TAG_NO.": rf_no, "TYPE": typ, "TEXT": tag_label, "NAME": tag_label, "LOCATION_(M)": loc},
                            "grips": [anc_tag, [wb_tag[0], wb_tag[1]], [wb_tag[2], wb_tag[1]], [wb_tag[2], wb_tag[3]], [wb_tag[0], wb_tag[3]]]
                        })
                        emitted += 1

                    if emitted > 0:
                        category_counts[cat_key] += (emitted - 1)
                        continue
        elif cat_key == "rfid_tags":
            rf_no = tags.get("RFID_TAG_NO.", "")
            typ = tags.get("TYPE", "")
            loc = tags.get("LOCATION_(M)", "")
            if dxftype == "INSERT":
                rot = float(getattr(e.dxf, "rotation", 0.0)) if hasattr(e, "dxf") else 0.0
                xs = float(getattr(e.dxf, "xscale", 1.0)) if hasattr(e, "dxf") else 1.0
                is_flipped = (xs < 0) ^ (90 < rot < 270)
                sym = "<" if is_flipped else ">"
                direction = "left" if is_flipped else "right"
                tags["DIRECTION"] = direction
                tags["DIR_SYMBOL"] = sym
            else:
                sym = "<" if "<" in text_clean else (">" if ">" in text_clean else "")
                if sym:
                    tags["DIRECTION"] = "left" if sym == "<" else "right"
                    tags["DIR_SYMBOL"] = sym
            parts = []
            if rf_no and rf_no != "R-":
                parts.append(f"Tag {rf_no}")
            if typ:
                parts.append(f"Direction {sym} {typ}")
            if loc and loc != "0":
                parts.append(f"Km {loc}")
            if parts:
                title = f"RFID ({' - '.join(parts)})"
            elif real_name.startswith("RFID - "):
                title = f"RFID ({real_name})"
            elif text_clean in ("N", "S", "L", "T", "G", "A"):
                title = f"Direction Text ({sym} {text_clean})"
            elif re.match(r"^\d{1,3}\.\d{2,3}$", text_clean):
                title = f"Location (Km {text_clean})"
            else:
                raw_t = tags.get('TEXT') or (real_name if not real_name.startswith("*U") else "")
                title = f"RFID Direction Arrow ({raw_t})" if raw_t else "RFID Direction Arrow"
        elif "CALLING" in real_name.upper():
            c_no = tags.get("SIGNAL_NO.") or tags.get("SIGNAL_NO") or tags.get("TEXT") or real_name
            title = f"Calling-On Signal ({c_no})"
        elif "SHUNT" in real_name.upper() or cat_key == "shunts":
            sh_no = tags.get("SHUNT_NO.") or tags.get("SHUNT_NO") or tags.get("SH_NO.") or tags.get("SH_NO") or tags.get("NAME") or tags.get("TEXT") or real_name
            title = f"Shunt Signal ({sh_no})"
        elif "SIGNAL BASE" in real_name.upper():
            sig_no = tags.get("SIGNAL_NO.") or tags.get("SIGNAL_NO") or ""
            title = f"Signal Base ({sig_no})" if sig_no else f"Signal Base ({real_name})"
        elif "ROUTE INDICATOR" in real_name.upper():
            sig_no = tags.get("SIGNAL_NO.") or tags.get("SIGNAL_NO") or ""
            title = f"Route Indicator ({sig_no})" if sig_no else f"Route Indicator ({real_name})"
        elif cat_key == "signals":
            sig_no = tags.get("SIGNAL_NO.") or tags.get("SIGNAL_NO") or tags.get("SIG_NO") or tags.get("NAME") or tags.get("TEXT")
            # If block has no aspect circles, but contains mast stem/arrowhead hatch, it is dynamically a Signal Base:
            is_base_geom = False
            if dxftype == "INSERT" and doc:
                b_ent = doc.blocks.get(getattr(e.dxf, "name", ""))
                if b_ent:
                    has_c = any(be.dxftype() == "CIRCLE" for be in b_ent)
                    has_m = any(be.dxftype() in ("HATCH", "SOLID") or (be.dxftype() == "LWPOLYLINE" and len(be) <= 4) for be in b_ent)
                    if not has_c and has_m:
                        is_base_geom = True
            if is_base_geom or "BASE" in real_name.upper():
                title = f"Signal Base ({sig_no})" if sig_no else f"Signal Base ({real_name})"
            elif sig_no:
                title = f"Signal {sig_no} ({real_name})"
            else:
                title = f"Signal ({real_name})"
        elif "MECHINE" in real_name.upper() or cat_key == "points":
            pt_no = tags.get("POINT_NO", tags.get("A_END_POINT_NO.", tags.get("B_END_POINT_NO.", real_name)))
            title = f"Point Machine ({pt_no})"
        elif "BOARD" in real_name.upper() or cat_key == "boards":
            title = real_name
        elif real_name == "Turnout Crossover" or (dxftype == "HATCH" and cat_key == "tracks_tins"):
            title = "Turnout Crossover (Turn Lines)"
        elif real_name.startswith("Axle Counter (DP"):
            title = real_name
        elif cat_key == "axle_counters":
            bpac_name = (
                tags.get("BPAC_RIGHT")
                or tags.get("BPAC_LEFT")
                or tags.get("LSS_RIGHT")
                or tags.get("DP")
                or tags.get("DP_NO")
                or tags.get("NAME")
                or ""
            )
            if not bpac_name:
                dp_vals = [v for k, v in tags.items() if "DP" in k or (isinstance(v, str) and (v.startswith("DP") or "BPAC" in v))]
                bpac_name = "/".join(list(dict.fromkeys(dp_vals))) if dp_vals else ""
            tr = tags.get("TRACK_NO", "")
            if bpac_name:
                title = f"Axle Counter ({bpac_name}{' - ' + tr if tr else ''})"
            elif tr:
                title = f"Axle Counter ({tr})"
            else:
                title = f"Axle Counter ({real_name})"
        else:
            title = tags.get("SIGNAL_NO.") or tags.get("SIGNAL_NO") or tags.get("TRACK_NO") or tags.get("RFID_TAG_NO.") or tags.get("TEXT") or real_name or dxftype

        name = f"{CATEGORY_CONFIG[cat_id - 1]['name']}: {title}"

        # Grips (anchor + 4 corners)
        grips = [
            anchor,
            [box[0], box[1]],
            [box[2], box[1]],
            [box[2], box[3]],
            [box[0], box[3]]
        ]

        # For Axle Counters spanning detection points, add cluster centers as grips
        if cat_key == "axle_counters" and dxftype == "INSERT" and doc:
            try:
                blk = doc.blocks.get(getattr(e.dxf, "name", ""))
                if blk:
                    ins_x = float(e.dxf.insert[0])
                    ins_y = float(e.dxf.insert[1])
                    xs = float(getattr(e.dxf, "xscale", 1.0))
                    centers = []
                    for be in blk:
                        if be.dxftype() == "LWPOLYLINE":
                            b_be = bbox.extents([be], cache=cache)
                            if b_be.has_data:
                                wx = ins_x + ((b_be.extmin.x + b_be.extmax.x) / 2.0) * xs
                                wy = ins_y + (b_be.extmin.y + b_be.extmax.y) / 2.0
                                centers.append((wx, wy))
                    if centers:
                        x_buckets: dict[int, list[tuple[float, float]]] = {}
                        for cx, cy in centers:
                            bx = int(round(cx / 5.0))
                            x_buckets.setdefault(bx, []).append((cx, cy))
                        for pts in x_buckets.values():
                            if len(pts) >= 2:
                                avg_x = sum(p[0] for p in pts) / len(pts)
                                avg_y = sum(p[1] for p in pts) / len(pts)
                                grips.append([avg_x, avg_y])
            except Exception:
                pass

        add_component({
            "id": handle or f"comp_{len(components)}",
            "category": cat_key,
            "categoryId": cat_id,
            "name": name,
            "layer": lyr_name,
            "layerId": layer_name_to_id.get(lyr_name, 0),
            "color": _color_hex(getattr(e.dxf, "color", 7)),
            "anchor": anchor,
            "bbox": box,
            "tags": tags,
            "grips": grips,
            "rotation": rot,
            "xscale": xs,
            "yscale": ys,
        })

    # Update category items with counts
    categories_out = []
    for c in CATEGORY_CONFIG:
        categories_out.append({
            **c,
            "count": category_counts.get(c["key"], 0)
        })

    return {
        "layers": layers_catalog,
        "categories": categories_out,
        "components": components,
        "totalComponents": len(components),
        "layerNameToId": layer_name_to_id,
        "dispositions": disposition_counts,
    }
