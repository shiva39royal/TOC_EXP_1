"""DXF -> compact binary render representation (".cadr").

The heavy lifting (BYLAYER/BYBLOCK resolution, blocks, dimensions, hatches,
line types, text) is done by ezdxf's drawing frontend. We only plug in a
recording backend that serialises the resulting primitives.

File layout (little endian):
    "CADR" | u32 version | u32 jsonLen | json (padded to 4 bytes)
    u32[nPaths*5]   meta: colorRGB, lineweight(1/100mm), flags, vertexCount, group
    f32[nVerts*2]   vertices, relative to json.origin (float64 in the header)

flags: bit0 fill | bits1-2 z-layer (0 fills, 1 lines, 2 text) | bit3 segment list
(vertex pairs) | bit4 point.  Original coordinates = origin + vertex.
"""
from __future__ import annotations

import gzip
import io
import json
import logging
import re
import struct
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np
import ezdxf
from ezdxf import bbox as ezbbox
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.backend import Backend
from ezdxf.addons.drawing.config import (
    BackgroundPolicy, Configuration, LinePolicy, TextPolicy,
)
from ezdxf.document import Drawing

# Patch ezdxf Drawing._update_header_vars to handle LibreDWG DXF files where $CMATERIAL has string handles
_orig_update_header_vars = Drawing._update_header_vars


def _safe_update_header_vars(self):
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


Drawing._update_header_vars = _safe_update_header_vars

from app.services.component_extractor import classify_entity

log = logging.getLogger("cad.render")

MAGIC, VERSION = b"CADR", 1
F_FILL, F_SEGMENTS, F_POINT = 1, 8, 16
Z_FILL, Z_LINE, Z_TEXT = 0, 1, 2
TEXT_TYPES = {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}

ProgressFn = Callable[[int, str], None]


def _rgb(color: str) -> int:
    return int(color[1:7], 16)


class RecordingBackend(Backend):
    """Collects flattened geometry. No rendering happens here."""

    def __init__(self, flatten: float, layer_map: dict[str, int] | None = None, doc: Any = None) -> None:
        super().__init__()
        self.flatten = flatten
        self.layer_map = layer_map or {}
        self.doc = doc
        self.meta: list[tuple[int, int, int, int, int]] = []
        self.chunks: list[np.ndarray] = []
        self.handles: list[str] = []
        self.group = 0
        self.top_level_entities = 0
        self.skipped_images = 0
        self._run_key: tuple | None = None
        self._run: list[np.ndarray] = []
        self._current_handle: str = ""
        self._multi_axle_blocks: set[str] = set()
        self._track_tin_blocks: set[str] = set()
        self._point_machine_blocks: set[str] = set()
        self._rfid_blocks: set[str] = set()
        self._fog_marker_blocks: set[str] = set()
        self._crossover_info: dict[str, dict[str, Any]] = {}
        if self.doc:
            try:
                for b in self.doc.blocks:
                    has_dp = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "DP_NO" for be in b)
                    is_ac = "axle" in b.name.lower() or b.name == "AC"
                    if has_dp or is_ac:
                        self._multi_axle_blocks.add(b.name)

                    has_line = any(be.dxftype() in ("LWPOLYLINE", "LINE", "POLYLINE") for be in b)
                    has_tag = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") in ("TIN_NO", "TRACK_NO") for be in b)
                    if has_line and has_tag and not (has_dp or is_ac):
                        self._track_tin_blocks.add(b.name)

                    has_pt = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") in ("POINT_NO", "B_END_POINT_NO.", "A_END_POINT_NO.") for be in b)
                    if has_pt:
                        self._point_machine_blocks.add(b.name)

                    has_rf_tag = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "RFID_TAG_NO." for be in b)
                    has_rf_type = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "TYPE" for be in b)
                    is_rf = "rfid" in b.name.lower()
                    if has_rf_tag or (has_rf_type and (is_rf or any(getattr(be.dxf, "tag", "") == "LOCATION_(M)" for be in b if be.dxftype() == "ATTDEF"))):
                        self._rfid_blocks.add(b.name)

                    has_fm = any(be.dxftype() == "ATTDEF" and getattr(be.dxf, "tag", "") == "FM_NO." for be in b)
                    if has_fm or b.name == "FM":
                        self._fog_marker_blocks.add(b.name)

                # Also mark parent blocks that insert a point machine, RFID, or Fog Marker block
                for b in self.doc.blocks:
                    if any(be.dxftype() == "INSERT" and getattr(be.dxf, "name", "") in self._point_machine_blocks for be in b):
                        self._point_machine_blocks.add(b.name)
                    if any(be.dxftype() == "INSERT" and getattr(be.dxf, "name", "") in self._rfid_blocks for be in b):
                        self._rfid_blocks.add(b.name)
                    if any(be.dxftype() == "INSERT" and getattr(be.dxf, "name", "") in self._fog_marker_blocks for be in b):
                        self._fog_marker_blocks.add(b.name)

                # Precompute world bounding box & End B location for crossover switch blocks
                for me in self.doc.modelspace():
                    if me.dxftype() == "INSERT":
                        bname = getattr(me.dxf, "name", "")
                        blk = self.doc.blocks.get(bname)
                        if blk:
                            target_b = blk
                            inner_ins = next((be for be in blk if be.dxftype() == "INSERT"), None)
                            if inner_ins:
                                b_inner = self.doc.blocks.get(getattr(inner_ins.dxf, "name", ""))
                                if b_inner:
                                    target_b = b_inner
                            polys = [be for be in target_b if be.dxftype() in ("LWPOLYLINE", "LINE", "POLYLINE")]
                            pxs = [p[0] for be in polys for p in getattr(be, "vertices", lambda: [])()]
                            if pxs and (max(pxs) - min(pxs) > 40.0):
                                b_all = ezbbox.extents([me])
                                if b_all.has_data:
                                    mid_x = (b_all.extmin.x + b_all.extmax.x) / 2.0
                                    attribs = list(getattr(me, "attribs", []))
                                    if inner_ins:
                                        attribs.extend(getattr(inner_ins, "attribs", []))
                                    pb_attr = next((a for a in attribs if "B_END" in getattr(a.dxf, "tag", "")), None)
                                    left_is_b = False
                                    if pb_attr:
                                        b_pb = ezbbox.extents([pb_attr])
                                        if b_pb.has_data:
                                            pbx = (b_pb.extmin.x + b_pb.extmax.x) / 2.0
                                            left_is_b = (pbx <= mid_x)
                                    h_me = getattr(me.dxf, "handle", "")
                                    if h_me:
                                        self._crossover_info[h_me] = {"mid_x": mid_x, "left_is_b": left_is_b}
            except Exception:
                pass

    # -- bookkeeping ------------------------------------------------------
    def _update_current_handle(self) -> None:
        if not self.entity_stack:
            h = ""
        else:
            top_e = self.entity_stack[0][0]
            top_h = getattr(top_e.dxf, "handle", "") or ""
            h = top_h
            if len(self.entity_stack) > 1 and top_e.dxftype() == "INSERT":
                top_bname = getattr(top_e.dxf, "name", "")
                if top_bname in self._multi_axle_blocks:
                    curr_e = self.entity_stack[-1][0]
                    ins = getattr(top_e.dxf, "insert", (0, 0))
                    cx = None
                    if hasattr(curr_e, "vertices"):
                        pts = list(curr_e.vertices())
                        if pts:
                            cx = pts[0][0]
                    elif hasattr(curr_e.dxf, "insert"):
                        cx = curr_e.dxf.insert[0]
                    elif hasattr(curr_e.dxf, "align_point") and curr_e.dxf.hasattr("align_point"):
                        cx = curr_e.dxf.align_point[0]
                    if cx is not None:
                        dist = abs(cx - ins[0])
                        h = f"{top_h}_0" if dist < 50.0 else f"{top_h}_1"
                elif top_bname in self._track_tin_blocks:
                    curr_e = self.entity_stack[-1][0]
                    if curr_e.dxftype() in ("LWPOLYLINE", "LINE", "POLYLINE"):
                        h = f"{top_h}_line"
                    elif curr_e.dxftype() in ("ATTRIB", "ATTDEF"):
                        tg = getattr(curr_e.dxf, "tag", "")
                        if tg == "TIN_NO":
                            h = f"{top_h}_tin"
                        elif tg == "TRACK_NO":
                            h = f"{top_h}_tc"
                        elif tg == "ROUTES":
                            h = f"{top_h}_routes"
                elif top_bname in self._fog_marker_blocks or any(getattr(x[0].dxf, "name", "") in self._fog_marker_blocks for x in self.entity_stack):
                    curr_e = self.entity_stack[-1][0]
                    if curr_e.dxftype() in ("ATTRIB", "ATTDEF") and getattr(curr_e.dxf, "tag", "").upper() == "LOCATION_(M)":
                        h = f"{top_h}_loc"
                    else:
                        h = f"{top_h}_fm"
                elif top_bname in self._rfid_blocks or any(getattr(x[0].dxf, "name", "") in self._rfid_blocks for x in self.entity_stack):
                    curr_e = self.entity_stack[-1][0]
                    if curr_e.dxftype() in ("ATTRIB", "ATTDEF"):
                        tg = getattr(curr_e.dxf, "tag", "").upper()
                        if tg == "RFID_TAG_NO.":
                            h = f"{top_h}_tag"
                        else:
                            h = f"{top_h}_dir"
                    else:
                        c = getattr(curr_e.dxf, "color", 256)
                        if c == 6:
                            h = f"{top_h}_tag"
                        else:
                            h = f"{top_h}_dir"
                elif top_bname in self._point_machine_blocks or any(getattr(x[0].dxf, "name", "") in self._point_machine_blocks for x in self.entity_stack):
                    curr_e = self.entity_stack[-1][0]
                    if curr_e.dxftype() in ("ATTRIB", "ATTDEF"):
                        tg = getattr(curr_e.dxf, "tag", "").upper()
                        if "A_END" in tg:
                            h = f"{top_h}_point_a"
                        elif "B_END" in tg:
                            h = f"{top_h}_point_b"
                        else:
                            h = f"{top_h}_point"
                    elif curr_e.dxftype() in ("LWPOLYLINE", "LINE", "POLYLINE"):
                        h = f"{top_h}_turnout"
        if h != self._current_handle:
            self._flush_run()
            self._current_handle = h

    def enter_entity(self, entity, properties) -> None:
        if not self.entity_stack:
            self.top_level_entities += 1
        super().enter_entity(entity, properties)
        self._update_current_handle()

    def exit_entity(self, entity) -> None:
        self._flush_run()
        super().exit_entity(entity)
        self._update_current_handle()

    def _z(self, default: int) -> int:
        if self.entity_stack and any(e[0].dxftype() in TEXT_TYPES for e in self.entity_stack):
            return Z_TEXT
        return default

    def _current_layer_and_cat(self) -> tuple[int, int]:
        if not self.entity_stack:
            return 0, 0
        for e, _ in reversed(self.entity_stack):
            try:
                res = classify_entity(e, self.doc)
                cat_id = res[1]
                lyr = getattr(e.dxf, "layer", "") or ""
                lid = self.layer_map.get(lyr, 0)
                if cat_id != 0 or lid != 0:
                    return lid, cat_id
            except Exception:
                pass
        return 0, 0

    def _flush_run(self) -> None:
        if self._run_key is not None and self._run:
            arr = np.concatenate(self._run)
            color, lw, z, lid, cid, handle = self._run_key
            comb_flags = F_SEGMENTS | (z << 1) | ((lid & 0xFFFF) << 8) | ((cid & 0xFF) << 24)
            self.meta.append((color, lw, comb_flags, len(arr), 0))
            self.chunks.append(arr)
            self.handles.append(handle)
        self._run_key, self._run = None, []

    def _resolve_handle_for_pts(self, pts: np.ndarray) -> str:
        h = self._current_handle
        if len(pts) > 0 and self.entity_stack:
            top_e = self.entity_stack[0][0]
            top_h = getattr(top_e.dxf, "handle", "")
            if top_h in self._crossover_info and "turnout" in h:
                info = self._crossover_info[top_h]
                mx = float(np.mean(pts[:, 0]))
                is_left = (mx <= info["mid_x"])
                h = f"{top_h}_turnout_b" if (is_left == info["left_is_b"]) else f"{top_h}_turnout_a"
        return h

    def _emit(self, pts: np.ndarray, props, flags: int, z: int, group: int = 0) -> None:
        if len(pts) == 0:
            return
        self._flush_run()
        handle = self._resolve_handle_for_pts(pts)
        lid, cid = self._current_layer_and_cat()
        comb_flags = (flags & 0xFF) | (z << 1) | ((lid & 0xFFFF) << 8) | ((cid & 0xFF) << 24)
        self.meta.append((_rgb(props.color), int(round(props.lineweight * 100)),
                          comb_flags, len(pts), group))
        self.chunks.append(pts)
        self.handles.append(handle)

    def _segments(self, pts: np.ndarray, props, z: int) -> None:
        lid, cid = self._current_layer_and_cat()
        handle = self._resolve_handle_for_pts(pts)
        key = (_rgb(props.color), int(round(props.lineweight * 100)), z, lid, cid, handle)
        if key != self._run_key:
            self._flush_run()
            self._run_key = key
        self._run.append(pts)

    def _poly(self, path) -> Iterable[np.ndarray]:
        for sub in path.sub_paths():
            pts = np.array([(v.x, v.y) for v in sub.flattening(self.flatten)], dtype=np.float64)
            if len(pts) >= 2:
                yield pts

    # -- BackendInterface -------------------------------------------------
    def configure(self, config) -> None:
        self.config = config

    def set_background(self, color) -> None: ...
    def clear(self) -> None: ...

    def finalize(self) -> None:
        self._flush_run()

    def draw_point(self, pos, properties) -> None:
        self._emit(np.array([[pos.x, pos.y]]), properties, F_POINT, self._z(Z_LINE))

    def draw_line(self, start, end, properties) -> None:
        self._segments(np.array([[start.x, start.y], [end.x, end.y]]), properties, self._z(Z_LINE))

    def draw_solid_lines(self, lines, properties) -> None:
        pts = np.array([(p.x, p.y) for a, b in lines for p in (a, b)], dtype=np.float64)
        if len(pts):
            self._segments(pts, properties, self._z(Z_LINE))

    def draw_path(self, path, properties) -> None:
        for pts in self._poly(path):
            self._emit(pts, properties, 0, self._z(Z_LINE))

    def draw_filled_paths(self, paths, properties) -> None:
        self.group += 1
        z = Z_TEXT if self._z(Z_FILL) == Z_TEXT else Z_FILL
        for path in paths:
            for pts in self._poly(path):
                self._emit(pts, properties, F_FILL, z, self.group)

    def draw_filled_polygon(self, points, properties) -> None:
        self.group += 1
        raw_pts = np.array([(v.x, v.y) for v in points.vertices()], dtype=np.float64)
        if len(raw_pts) < 3:
            return
        z = self._z(Z_LINE)

        # Detect and split multi-loop contours (e.g. wide polyline ribbons where outer
        # and inner contours both close onto their start vertex)
        contours: list[np.ndarray] = []
        n = len(raw_pts)
        start = 0
        i = 1
        while i < n:
            if np.allclose(raw_pts[i], raw_pts[start], atol=1e-4):
                contours.append(raw_pts[start : i + 1])
                start = i + 1
                i = start + 1
            else:
                i += 1
        if start < n:
            contours.append(raw_pts[start:])

        for contour in contours:
            if len(contour) >= 3:
                self._emit(contour, properties, F_FILL, z, self.group)

    def draw_image(self, image_data, properties) -> None:
        self.skipped_images += 1

    # -- output -----------------------------------------------------------
    def encode(self) -> tuple[bytes, dict | None, int]:
        """Returns (cadr bytes, bounds dict | None, vertex count)."""
        self._flush_run()
        if not self.chunks:
            return b"", None, 0
        allv = np.concatenate(self.chunks)
        mn, mx = allv.min(axis=0), allv.max(axis=0)
        origin = (mn + mx) / 2.0
        verts = (allv - origin).astype("<f4")
        meta = np.asarray(self.meta, dtype="<u4")
        header = {
            "origin": [float(origin[0]), float(origin[1])],
            "bounds": {"minX": float(mn[0]), "minY": float(mn[1]),
                       "maxX": float(mx[0]), "maxY": float(mx[1])},
            "paths": int(len(meta)), "vertices": int(len(verts)),
            "handles": self.handles,
        }
        raw = json.dumps(header).encode()
        raw += b" " * (-len(raw) % 4)
        blob = MAGIC + struct.pack("<II", VERSION, len(raw)) + raw + meta.tobytes() + verts.tobytes()
        return blob, header["bounds"], len(verts)


def load_dxf(path: Path):
    """Tolerant loader: repairs structural problems common in converted files."""
    try:
        raw = path.read_bytes()
        # If the file uses CRLF but contains bare newlines, sanitize them
        if b"\r\n" in raw and re.search(rb"(?<!\r)\n", raw):
            import io
            cleaned = re.sub(rb"(?<!\r)\n", b" ", raw)
            doc, auditor = recover.read(io.BytesIO(cleaned))
            if auditor.has_errors:
                log.warning("DXF recovered with %d errors", len(auditor.errors))
            return doc
        doc, auditor = recover.readfile(str(path))
        if auditor.has_errors:
            log.warning("DXF recovered with %d errors", len(auditor.errors))
        return doc
    except Exception:
        log.exception("recover.readfile failed, trying strict reader")
        return ezdxf.readfile(str(path))


def _layout_order(doc) -> list:
    names = doc.layout_names_in_taborder()
    return [doc.layouts.get(n) for n in names]


def _flatten_distance(layout) -> float:
    try:
        box = ezbbox.extents(layout, fast=True)
        diag = float(box.size.magnitude) if box.has_data else 0.0
    except Exception:
        diag = 0.0
    return max(diag * 2e-6, 1e-9) if diag > 0 else 0.01


def render_layout(doc, layout, layer_map: dict[str, int] | None = None) -> tuple[bytes, dict | None, int, RecordingBackend]:
    fd = _flatten_distance(layout)
    backend = RecordingBackend(fd, layer_map=layer_map, doc=doc)
    cfg = Configuration(
        line_policy=LinePolicy.ACCURATE,
        text_policy=TextPolicy.FILLING,
        background_policy=BackgroundPolicy.CUSTOM,
        custom_bg_color="#000000",
        max_flattening_distance=fd,
        min_dash_length=fd,
        lineweight_scaling=1.0,
        pdsize=1.0,
    )
    ctx = RenderContext(doc)
    Frontend(ctx, backend, config=cfg).draw_layout(layout, finalize=True)
    blob, bounds, nverts = backend.encode()
    return blob, bounds, nverts, backend


def build_render_set(dxf: Path, out_dir: Path, progress: ProgressFn | None = None, dwg_path: Path | None = None) -> dict:
    """Render every non-empty layout to out_dir/layout_<n>.cadr.gz and return the manifest dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    report = progress or (lambda p, s: None)
    report(5, "Reading CAD data")
    doc = load_dxf(dxf)
    if dwg_path and dwg_path.exists():
        try:
            from app.services.dxf_enhancer import enhance_doc_from_dwg
            enhance_doc_from_dwg(doc, dwg_path)
            doc.saveas(dxf)
        except Exception as exc:
            log.warning("DWG attribute enhancement failed: %s", exc)

    # Verify CAD fidelity & structural integrity
    manifest: dict = {"layouts": [], "warnings": []}
    try:
        from app.services.cad.conversion_verifier import CadConversionVerifier
        fidelity_report = CadConversionVerifier.verify_document(doc, file_name=dxf.name)
        manifest["fidelity"] = {
            "isValid": fidelity_report.is_valid,
            "dxfVersion": fidelity_report.dxf_version,
            "totalEntities": fidelity_report.total_entities,
            "entityCounts": fidelity_report.entity_counts,
            "totalLayers": fidelity_report.total_layers,
            "totalBlocks": fidelity_report.total_blocks,
            "anonymousBlocksCount": fidelity_report.anonymous_blocks_count,
            "standardBlocksCount": fidelity_report.standard_blocks_count,
            "drawingExtents": fidelity_report.drawing_extents,
            "isEmptyOrCorrupt": fidelity_report.is_empty_or_corrupt,
        }
        if fidelity_report.warnings:
            manifest["warnings"].extend(fidelity_report.warnings)
    except Exception as exc:
        log.warning("Fidelity verification failed: %s", exc)

    # Extract domain components and layer catalog
    layer_map: dict[str, int] = {}
    try:
        from app.services.component_extractor import extract_components
        comp_data = extract_components(doc, dwg_path=dwg_path)
        (out_dir / "components.json").write_text(json.dumps(comp_data, indent=2))
        manifest["categories"] = comp_data.get("categories", [])
        manifest["cadLayers"] = comp_data.get("layers", [])
        manifest["totalComponents"] = comp_data.get("totalComponents", 0)
        layer_map = comp_data.get("layerNameToId", {})
    except Exception as exc:
        log.warning("Component extraction failed: %s", exc)
        manifest["categories"] = []
        manifest["cadLayers"] = []

    # Focus solely on Model space (the primary CAD drawing); omit paper layouts like Layout1
    layouts = [doc.modelspace()]
    skipped_images = 0
    for i, layout in enumerate(layouts):
        is_model = True
        report(10 + int(85 * i / max(len(layouts), 1)), f"Rendering {layout.name}")
        try:
            blob, bounds, nverts, be = render_layout(doc, layout, layer_map=layer_map)
        except Exception:
            log.exception("layout %s failed", layout.name)
            manifest["warnings"].append(f"Layout '{layout.name}' could not be rendered.")
            continue
        skipped_images += be.skipped_images
        if blob:
            (out_dir / f"layout_{i}.cadr.gz").write_bytes(gzip.compress(blob, 5))
        manifest["layouts"].append({
            "id": i, "name": layout.name, "isModel": is_model,
            "entityCount": be.top_level_entities, "bounds": bounds, "hasData": bool(blob),
        })
        log.info("layout %s: %d entities, %d vertices", layout.name, be.top_level_entities, nverts)
    if skipped_images:
        manifest["warnings"].append(f"{skipped_images} raster image(s) are not displayed.")
    if not any(l["hasData"] for l in manifest["layouts"]):
        raise ValueError("The drawing contains no displayable geometry.")
    (out_dir / "manifest.json").write_text(json.dumps(manifest))
    return manifest


def render_reference_png(dxf: Path, layout_id: int, out_png: Path, dpi: int = 110) -> None:
    """Independent reference raster (ezdxf + Matplotlib) used by the validation view."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

    doc = load_dxf(dxf)
    layout = _layout_order(doc)[layout_id]
    fig = plt.figure(figsize=(14, 9), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    cfg = Configuration(background_policy=BackgroundPolicy.CUSTOM, custom_bg_color="#000000", pdsize=1.0)
    Frontend(RenderContext(doc), MatplotlibBackend(ax), config=cfg).draw_layout(layout, finalize=True)
    fig.savefig(out_png, facecolor="#000000")
    plt.close(fig)
