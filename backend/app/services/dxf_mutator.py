"""DXF Mutation and Editing Engine.

Applies spatial moves, tag edits, attribute updates, and entity deletions
directly into the underlying DXF CAD document, and re-triggers fast rendering.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import bbox
from ezdxf.math import Vec3

import types
from app.services import render_service
from app.services.component_extractor import extract_components
from ezdxf.document import Drawing


def _safe_update_header_vars(self):
    """Safely updates header vars to handle LibreDWG DXF files where $CMATERIAL has string handles."""
    try:
        from ezdxf.lldxf.const import acad_maint_ver
        material = self.entitydb.get(self.header.get("$CMATERIAL", None))
        if material is None or getattr(material, "dxftype", lambda: "")() != "MATERIAL":
            handle = "0"
            try:
                if "ByLayer" in self.materials:
                    mat = self.materials.get("ByLayer")
                    handle = getattr(getattr(mat, "dxf", None), "handle", str(mat) if isinstance(mat, str) else "0")
                elif "Global" in self.materials:
                    mat = self.materials.get("Global")
                    handle = getattr(getattr(mat, "dxf", None), "handle", str(mat) if isinstance(mat, str) else "0")
            except Exception:
                handle = "0"
            self.header["$CMATERIAL"] = handle
        self.header["$ACADMAINTVER"] = acad_maint_ver.get(self.dxfversion, 0)
    except Exception:
        pass

log = logging.getLogger("cad.mutator")


def apply_modifications(
    dxf_path: Path,
    render_dir: Path,
    moves: list[dict[str, Any]] | None = None,
    updates: list[dict[str, Any]] | None = None,
    deletions: list[str] | None = None,
    additions: list[dict[str, Any]] | None = None,
    dwg_path: Path | None = None,
) -> dict[str, Any]:
    """Applies mutations to DXF document, saves it, and re-renders.

    moves: [{ "id": "handle", "dx": float, "dy": float }]
    updates: [{ "id": "handle", "tags": { "TAG_NAME": "val" }, "layer": "name", "color": int }]
    deletions: ["handle1", "handle2"]
    additions: [{ "temp_id": "...", "source_handle": "...", "insert_pos": [x, y], "tags": {...} }]
    """
    if not dxf_path.is_file():
        raise FileNotFoundError(f"DXF file not found: {dxf_path}")

    doc = ezdxf.readfile(dxf_path)
    doc._update_header_vars = types.MethodType(_safe_update_header_vars, doc)
    if dwg_path and dwg_path.is_file():
        has_any_attrib = any(hasattr(e, "attribs") and len(e.attribs) > 0 for e in doc.modelspace())
        if not has_any_attrib:
            try:
                from app.services.dxf_enhancer import enhance_doc_from_dwg
                enhance_doc_from_dwg(doc, dwg_path)
            except Exception as exc:
                log.warning("Could not enhance doc from DWG in mutator: %s", exc)

    msp = doc.modelspace()

    # Index entities by handle
    entity_by_handle = {}
    for e in msp:
        h = getattr(e.dxf, "handle", None)
        if h:
            entity_by_handle[h] = e

    # 0. Apply Additions / Clones
    if additions:
        for add in additions:
            src_h = add.get("source_handle") or ""
            base_h = src_h.split("_")[0] if "_" in src_h else src_h
            sub_role = add.get("sub_role") or (src_h.rsplit("_", 1)[1] if "_" in src_h else None)
            src_e = entity_by_handle.get(base_h)
            if not src_e:
                continue

            ins_pos = add.get("insert_pos", [0.0, 0.0])
            tags = add.get("tags") or {}
            layer_override = add.get("layer") or src_e.dxf.layer
            color_override = add.get("color") if add.get("color") is not None else getattr(src_e.dxf, "color", 256)

            dxftype = src_e.dxftype()
            if dxftype == "INSERT":
                src_ins = getattr(src_e.dxf, "insert", (0.0, 0.0, 0.0))
                new_ins = (ins_pos[0], ins_pos[1], src_ins[2] if len(src_ins) > 2 else 0.0)
                dx = new_ins[0] - src_ins[0]
                dy = new_ins[1] - src_ins[1]
                delta = Vec3(dx, dy, 0)

                dxfattribs = {
                    "layer": layer_override,
                    "color": color_override,
                    "xscale": getattr(src_e.dxf, "xscale", 1.0),
                    "yscale": getattr(src_e.dxf, "yscale", 1.0),
                    "rotation": getattr(src_e.dxf, "rotation", 0.0),
                }
                new_insert = msp.add_blockref(src_e.dxf.name, insert=new_ins, dxfattribs=dxfattribs)

                for a in getattr(src_e, "attribs", []):
                    a_tag = a.dxf.tag
                    val = tags.get(a_tag) or tags.get(a_tag.upper()) or tags.get("NAME") or tags.get("TEXT") or a.dxf.text
                    a_attribs = {
                        "layer": a.dxf.layer,
                        "color": getattr(a.dxf, "color", 256),
                        "height": getattr(a.dxf, "height", 2.5),
                        "rotation": getattr(a.dxf, "rotation", 0.0),
                        "style": getattr(a.dxf, "style", "Standard"),
                    }
                    new_a = new_insert.add_attrib(a_tag, text=str(val), insert=Vec3(a.dxf.insert) + delta, dxfattribs=a_attribs)
                    if hasattr(a.dxf, "align_point") and a.dxf.hasattr("align_point"):
                        new_a.dxf.align_point = Vec3(a.dxf.align_point) + delta

                new_h = new_insert.dxf.handle
                entity_by_handle[new_h] = new_insert
                temp_id = add.get("temp_id")
                if temp_id:
                    entity_by_handle[temp_id] = new_insert

            elif dxftype in ("LWPOLYLINE", "POLYLINE", "LINE", "TEXT", "MTEXT", "SOLID", "HATCH"):
                b = bbox.extents([src_e])
                cx = (b.extmin.x + b.extmax.x) / 2.0 if b.has_data else 0.0
                cy = (b.extmin.y + b.extmax.y) / 2.0 if b.has_data else 0.0
                dx = ins_pos[0] - cx
                dy = ins_pos[1] - cy
                delta = Vec3(dx, dy, 0)

                new_e = src_e.copy()
                if new_e.dxftype() == "LWPOLYLINE":
                    pts = new_e.get_points(format="xyseb")
                    new_e.set_points([(p[0] + dx, p[1] + dy, p[2], p[3], p[4]) for p in pts], format="xyseb")
                elif new_e.dxftype() == "LINE":
                    new_e.dxf.start = Vec3(new_e.dxf.start) + delta
                    new_e.dxf.end = Vec3(new_e.dxf.end) + delta
                elif new_e.dxftype() in ("TEXT", "MTEXT"):
                    new_e.dxf.insert = Vec3(new_e.dxf.insert) + delta
                    if hasattr(new_e.dxf, "align_point") and new_e.dxf.hasattr("align_point"):
                        new_e.dxf.align_point = Vec3(new_e.dxf.align_point) + delta
                    val = tags.get("NAME") or tags.get("TEXT") or (list(tags.values())[0] if tags else None)
                    if val is not None:
                        if new_e.dxftype() == "TEXT":
                            new_e.dxf.text = str(val)
                        else:
                            new_e.text = str(val)
                elif hasattr(new_e.dxf, "insert"):
                    new_e.dxf.insert = Vec3(new_e.dxf.insert) + delta

                new_e.dxf.layer = layer_override
                if color_override is not None:
                    new_e.dxf.color = color_override

                msp.add_entity(new_e)
                new_h = new_e.dxf.handle
                entity_by_handle[new_h] = new_e
                temp_id = add.get("temp_id")
                if temp_id:
                    entity_by_handle[temp_id] = new_e

    # 1. Apply Moves
    if moves:
        for m in moves:
            h = m.get("id")
            dx = float(m.get("dx", 0.0))
            dy = float(m.get("dy", 0.0))
            if not h or (dx == 0.0 and dy == 0.0):
                continue
            e = entity_by_handle.get(h)
            sub_role = None
            if not e and "_" in h:
                base_h, sub_role = h.rsplit("_", 1)
                e = entity_by_handle.get(base_h)
            if not e:
                continue

            dxftype = e.dxftype()
            delta = Vec3(dx, dy, 0)

            # Move based on entity type and sub_role
            if dxftype == "INSERT" and sub_role in ("tin", "tc", "routes", "point", "point_a", "point_b", "tag", "dir", "turnout", "turnout_a", "turnout_b", "loc", "fm"):
                if sub_role == "tin":
                    target_tags = {"TIN_NO"}
                elif sub_role == "tc":
                    target_tags = {"TRACK_NO"}
                elif sub_role == "routes":
                    target_tags = {"ROUTES"}
                elif sub_role == "point_a":
                    target_tags = {"A_END_POINT_NO.", "POINT_NO"}
                elif sub_role == "point_b":
                    target_tags = {"B_END_POINT_NO.", "POINT_NO"}
                elif sub_role == "point":
                    target_tags = {"B_END_POINT_NO.", "A_END_POINT_NO.", "POINT_NO"}
                elif sub_role == "tag":
                    target_tags = {"RFID_TAG_NO."}
                elif sub_role == "dir":
                    target_tags = {"TYPE", "LOCATION_(M)", "LINE", "ROUTES"}
                elif sub_role == "loc":
                    target_tags = {"LOCATION_(M)"}
                elif sub_role == "fm":
                    target_tags = {"FM_NO."}
                else:
                    target_tags = set()

                all_attribs = list(getattr(e, "attribs", []))
                blk = doc.blocks.get(getattr(e.dxf, "name", ""))
                target_b = blk
                if blk:
                    for be in blk:
                        if be.dxftype() == "INSERT":
                            all_attribs.extend(getattr(be, "attribs", []))
                            inner_b = doc.blocks.get(getattr(be.dxf, "name", ""))
                            if inner_b:
                                target_b = inner_b

                # Move attributes
                for a in all_attribs:
                    if getattr(a.dxf, "tag", "").upper() in target_tags:
                        if hasattr(a.dxf, "insert"):
                            a.dxf.insert = Vec3(a.dxf.insert) + delta
                        if hasattr(a.dxf, "align_point") and a.dxf.hasattr("align_point"):
                            a.dxf.align_point = Vec3(a.dxf.align_point) + delta

                # Move inner geometry for turnouts, RFID tags/arrows, and FM board
                if sub_role in ("tag", "dir"):
                    # Isolate RFID tag by cloning its inner block so moving it never disturbs any other tag
                    inner_ins = next((be for be in blk if be.dxftype() == "INSERT"), None) if blk else None
                    if inner_ins:
                        orig_inner_name = getattr(inner_ins.dxf, "name", "")
                        inner_b = doc.blocks.get(orig_inner_name)
                        if inner_b:
                            clone_name = f"*U_rfid_{base_h}"
                            cloned_b = doc.blocks.get(clone_name)
                            if not cloned_b:
                                cloned_b = doc.blocks.new(name=clone_name)
                                for be in inner_b:
                                    cloned_b.add_entity(be.copy())
                            inner_ins.dxf.name = clone_name
                            target_b = cloned_b

                    # Compute exact 2D inverse transformation matrix M^-1 = (R_o @ S_o @ R_i @ S_i)^-1
                    import math
                    rot_o = math.radians(float(getattr(e.dxf, "rotation", 0.0)))
                    sx_o = float(getattr(e.dxf, "xscale", 1.0)) or 1.0
                    sy_o = float(getattr(e.dxf, "yscale", 1.0)) or 1.0
                    cos_o, sin_o = math.cos(rot_o), math.sin(rot_o)
                    m00_o, m01_o = cos_o * sx_o, -sin_o * sy_o
                    m10_o, m11_o = sin_o * sx_o, cos_o * sy_o

                    if inner_ins:
                        rot_i = math.radians(float(getattr(inner_ins.dxf, "rotation", 0.0)))
                        sx_i = float(getattr(inner_ins.dxf, "xscale", 1.0)) or 1.0
                        sy_i = float(getattr(inner_ins.dxf, "yscale", 1.0)) or 1.0
                        cos_i, sin_i = math.cos(rot_i), math.sin(rot_i)
                        m00_i, m01_i = cos_i * sx_i, -sin_i * sy_i
                        m10_i, m11_i = sin_i * sx_i, cos_i * sy_i

                        m00 = m00_o * m00_i + m01_o * m10_i
                        m01 = m00_o * m01_i + m01_o * m11_i
                        m10 = m10_o * m00_i + m11_o * m10_i
                        m11 = m10_o * m01_i + m11_o * m11_i
                    else:
                        m00, m01 = m00_o, m01_o
                        m10, m11 = m10_o, m11_o

                    det = m00 * m11 - m01 * m10
                    if abs(det) > 1e-9:
                        local_dx = (m11 * dx - m01 * dy) / det
                        local_dy = (-m10 * dx + m00 * dy) / det
                    else:
                        local_dx, local_dy = dx, dy
                    local_delta = Vec3(local_dx, local_dy, 0)

                    if target_b:
                        if sub_role == "tag":
                            target_polys = [be for be in target_b if getattr(be.dxf, "color", 0) == 6 and be.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE")]
                        else:
                            target_polys = [be for be in target_b if getattr(be.dxf, "color", 0) != 6 and be.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE", "SOLID")]

                        for pe in target_polys:
                            if pe.dxftype() == "LWPOLYLINE":
                                pts = pe.get_points(format="xyseb")
                                pe.set_points([(p[0] + local_delta.x, p[1] + local_delta.y, p[2], p[3], p[4]) for p in pts], format="xyseb")
                            elif pe.dxftype() == "LINE":
                                pe.dxf.start = Vec3(pe.dxf.start) + local_delta
                                pe.dxf.end = Vec3(pe.dxf.end) + local_delta
                            elif pe.dxftype() == "SOLID":
                                try:
                                    pe.dxf.vtx0 = Vec3(pe.dxf.vtx0) + local_delta
                                    pe.dxf.vtx1 = Vec3(pe.dxf.vtx1) + local_delta
                                    pe.dxf.vtx2 = Vec3(pe.dxf.vtx2) + local_delta
                                    if hasattr(pe.dxf, "vtx3"):
                                        pe.dxf.vtx3 = Vec3(pe.dxf.vtx3) + local_delta
                                except Exception:
                                    pass

                        # Also shift ATTDEF in target_b
                        for be in target_b:
                            if be.dxftype() == "ATTDEF":
                                is_tag_att = getattr(be.dxf, "tag", "").upper() == "RFID_TAG_NO."
                                if (sub_role == "tag" and is_tag_att) or (sub_role == "dir" and not is_tag_att):
                                    if hasattr(be.dxf, "insert"):
                                        be.dxf.insert = Vec3(be.dxf.insert) + local_delta
                                    if hasattr(be.dxf, "align_point") and be.dxf.hasattr("align_point"):
                                        be.dxf.align_point = Vec3(be.dxf.align_point) + local_delta

                elif sub_role in ("turnout_a", "turnout_b", "turnout", "fm") and target_b:
                    xs = float(getattr(e.dxf, "xscale", 1.0)) or 1.0
                    ys = float(getattr(e.dxf, "yscale", 1.0)) or 1.0
                    local_delta = Vec3(dx / xs, dy / ys, 0)

                    if sub_role == "fm":
                        target_polys = [be for be in target_b if getattr(be.dxf, "tag", "") != "LOCATION_(M)" and be.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE", "SOLID")]
                    elif sub_role in ("turnout_a", "turnout_b"):
                        all_p = [be for be in target_b if be.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE")]
                        pxs = [p[0] for be in all_p for p in getattr(be, "vertices", lambda: [])()]
                        local_mid_x = (min(pxs) + max(pxs)) / 2.0 if pxs else 0.0

                        # Check End B position
                        pb_attr = next((a for a in all_attribs if "B_END" in getattr(a.dxf, "tag", "")), None)
                        is_left_b = False
                        if pb_attr:
                            b_pb = bbox.extents([pb_attr])
                            b_all = bbox.extents([e])
                            if b_pb.has_data and b_all.has_data:
                                pbx = (b_pb.extmin.x + b_pb.extmax.x) / 2.0
                                mid_x_world = (b_all.extmin.x + b_all.extmax.x) / 2.0
                                is_left_b = (pbx <= mid_x_world)

                        if (sub_role == "turnout_a" and not is_left_b) or (sub_role == "turnout_b" and is_left_b):
                            target_polys = [be for be in all_p if hasattr(be, "vertices") and (((min(p[0] for p in be.vertices()) + max(p[0] for p in be.vertices())) / 2.0) <= local_mid_x)]
                        else:
                            target_polys = [be for be in all_p if hasattr(be, "vertices") and (((min(p[0] for p in be.vertices()) + max(p[0] for p in be.vertices())) / 2.0) > local_mid_x)]
                    else:
                        target_polys = [be for be in target_b if be.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE")]

                    for pe in target_polys:
                        if pe.dxftype() == "LWPOLYLINE":
                            pts = pe.get_points(format="xyseb")
                            pe.set_points([(p[0] + local_delta.x, p[1] + local_delta.y, p[2], p[3], p[4]) for p in pts], format="xyseb")
                        elif pe.dxftype() == "LINE":
                            pe.dxf.start = Vec3(pe.dxf.start) + local_delta
                            pe.dxf.end = Vec3(pe.dxf.end) + local_delta
                        elif pe.dxftype() == "SOLID":
                            try:
                                pe.dxf.vtx0 = Vec3(pe.dxf.vtx0) + local_delta
                                pe.dxf.vtx1 = Vec3(pe.dxf.vtx1) + local_delta
                                pe.dxf.vtx2 = Vec3(pe.dxf.vtx2) + local_delta
                                if hasattr(pe.dxf, "vtx3"):
                                    pe.dxf.vtx3 = Vec3(pe.dxf.vtx3) + local_delta
                            except Exception:
                                pass

            elif hasattr(e.dxf, "insert"):
                cur_ins = Vec3(e.dxf.insert)
                e.dxf.insert = cur_ins + delta
                if hasattr(e.dxf, "align_point") and e.dxf.hasattr("align_point"):
                    e.dxf.align_point = Vec3(e.dxf.align_point) + delta
                if not sub_role and dxftype == "INSERT":
                    for a in getattr(e, "attribs", []):
                        if hasattr(a.dxf, "insert"):
                            a.dxf.insert = Vec3(a.dxf.insert) + delta
                        if hasattr(a.dxf, "align_point") and a.dxf.hasattr("align_point"):
                            a.dxf.align_point = Vec3(a.dxf.align_point) + delta

            elif dxftype == "LINE":
                e.dxf.start = Vec3(e.dxf.start) + delta
                e.dxf.end = Vec3(e.dxf.end) + delta

            elif dxftype == "LWPOLYLINE":
                pts = e.get_points(format="xyseb")
                new_pts = []
                for p in pts:
                    new_pts.append((p[0] + dx, p[1] + dy, p[2], p[3], p[4]))
                e.set_points(new_pts, format="xyseb")

            elif dxftype == "POLYLINE":
                for v in e.vertices:
                    v.dxf.location = Vec3(v.dxf.location) + delta

            elif dxftype == "CIRCLE":
                e.dxf.center = Vec3(e.dxf.center) + delta

            elif dxftype == "ARC":
                e.dxf.center = Vec3(e.dxf.center) + delta

            elif dxftype == "HATCH":
                try:
                    for path in e.paths:
                        if hasattr(path, "vertices"):
                            path.vertices = [Vec3(v) + delta for v in path.vertices]
                        elif hasattr(path, "edges"):
                            for edge in path.edges:
                                if hasattr(edge, "start"):
                                    edge.start = Vec3(edge.start) + delta
                                if hasattr(edge, "end"):
                                    edge.end = Vec3(edge.end) + delta
                                if hasattr(edge, "center"):
                                    edge.center = Vec3(edge.center) + delta
                except Exception:
                    pass

    # 2. Apply Property & Tag Updates
    if updates:
        for u in updates:
            h = u.get("id")
            if not h:
                continue
            e = entity_by_handle.get(h)
            sub_role = None
            if not e and "_" in h:
                base_h, sub_role = h.rsplit("_", 1)
                e = entity_by_handle.get(base_h)
            if not e:
                continue

            # Layer update
            if "layer" in u and u["layer"]:
                e.dxf.layer = str(u["layer"])

            # Color update
            if "color" in u and u["color"] is not None:
                try:
                    c = int(u["color"])
                    if 0 <= c <= 256:
                        e.dxf.color = c
                except (ValueError, TypeError):
                    pass

            # Tag & Name updates
            tags = u.get("tags")
            if tags and isinstance(tags, dict):
                dxftype = e.dxftype()
                if dxftype == "INSERT":
                    if sub_role == "tin":
                        target_tags = {"TIN_NO"}
                    elif sub_role == "tc":
                        target_tags = {"TRACK_NO"}
                    elif sub_role == "routes":
                        target_tags = {"ROUTES"}
                    elif sub_role == "point_a":
                        target_tags = {"A_END_POINT_NO.", "POINT_NO"}
                    elif sub_role == "point_b":
                        target_tags = {"B_END_POINT_NO.", "POINT_NO"}
                    elif sub_role == "point":
                        target_tags = {"B_END_POINT_NO.", "A_END_POINT_NO.", "POINT_NO"}
                    elif sub_role == "tag":
                        target_tags = {"RFID_TAG_NO."}
                    elif sub_role == "dir":
                        target_tags = {"TYPE", "LOCATION_(M)"}
                    elif sub_role == "loc":
                        target_tags = {"LOCATION_(M)"}
                    elif sub_role == "fm":
                        target_tags = {"FM_NO."}
                    else:
                        target_tags = None

                    all_attribs = list(getattr(e, "attribs", []))
                    blk = doc.blocks.get(getattr(e.dxf, "name", ""))
                    if blk:
                        for be in blk:
                            if be.dxftype() == "INSERT":
                                all_attribs.extend(getattr(be, "attribs", []))

                    if sub_role in ("tag", "dir"):
                        inner_ins = next((be for be in blk if be.dxftype() == "INSERT"), None) if blk else None
                        target_b = blk
                        if inner_ins:
                            orig_inner_name = getattr(inner_ins.dxf, "name", "")
                            inner_b = doc.blocks.get(orig_inner_name)
                            if inner_b:
                                clone_name = f"*U_rfid_{base_h}"
                                cloned_b = doc.blocks.get(clone_name)
                                if not cloned_b:
                                    cloned_b = doc.blocks.new(name=clone_name)
                                    for be in inner_b:
                                        cloned_b.add_entity(be.copy())
                                inner_ins.dxf.name = clone_name
                                target_b = cloned_b
                        if target_b:
                            for be in target_b:
                                if be.dxftype() == "ATTDEF":
                                    a_tag = getattr(be.dxf, "tag", "").upper()
                                    if target_tags and a_tag in target_tags:
                                        val = tags.get(a_tag) or tags.get(a_tag.lower()) or tags.get("NAME") or tags.get("TEXT") or tags.get("text")
                                        if val is not None:
                                            be.dxf.text = str(val)

                    for a in all_attribs:
                        a_tag = getattr(a.dxf, "tag", "").upper()
                        if target_tags and a_tag in target_tags:
                            val = tags.get(a_tag) or tags.get(a_tag.lower()) or tags.get("NAME") or tags.get("TEXT") or tags.get("text")
                            if val is not None:
                                a.dxf.text = str(val)
                        elif not target_tags:
                            for tk, tv in tags.items():
                                if tk.upper() == a_tag:
                                    a.dxf.text = str(tv)
                    # If specific sub-role tag not found in existing attribs, assign primary text
                    if target_tags and not any(getattr(a.dxf, "tag", "").upper() in target_tags for a in all_attribs):
                        val = tags.get("NAME") or tags.get("TEXT") or list(tags.values())[0] if tags else None
                        if val is not None and all_attribs:
                            all_attribs[0].dxf.text = str(val)

                elif dxftype == "TEXT":
                    val = tags.get("NAME") or tags.get("TEXT") or tags.get("text") or (list(tags.values())[0] if tags else None)
                    if val is not None:
                        e.dxf.text = str(val)
                elif dxftype == "MTEXT":
                    val = tags.get("NAME") or tags.get("TEXT") or tags.get("text") or (list(tags.values())[0] if tags else None)
                    if val is not None:
                        e.text = str(val)

    # 3. Apply Deletions
    if deletions:
        for h in deletions:
            e = entity_by_handle.get(h)
            if e:
                try:
                    msp.delete_entity(e)
                except Exception as ex:
                    log.warning("Could not delete entity %s: %s", h, ex)

    # Save mutated DXF back to disk
    doc.saveas(dxf_path)
    log.info("Saved modified DXF to %s", dxf_path)

    # Re-build render set (fast Model space re-render)
    # CRITICAL: Do NOT pass dwg_path here, so the mutated DXF is not overwritten by original DWG!
    manifest = render_service.build_render_set(dxf_path, render_dir, lambda p, s: None, dwg_path=None)
    (render_dir / "manifest.json").write_text(json.dumps(manifest))

    # Extract updated components
    components_data = extract_components(doc, dwg_path=None)
    (render_dir / "components.json").write_text(json.dumps(components_data))

    return {
        "manifest": manifest,
        "components": components_data
    }
