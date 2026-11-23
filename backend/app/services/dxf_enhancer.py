"""DWG -> DXF in-memory post-processing enhancer.

Extracts all visible ATTRIB entities from the source DWG (which LibreDWG's dwg2dxf
drops when converting complex/dynamic blocks into DXF) using dwgread JSON export,
and injects missing labels directly into the ezdxf document modelspace.
"""
from __future__ import annotations

import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.config import BASE_DIR, settings

log = logging.getLogger("cad.enhancer")


def _find_dwgread() -> str | None:
    p = Path(settings.libredwg_dwg2dxf_path)
    if p.exists():
        reader = p.with_name("dwgread.exe" if os.name == "nt" else "dwgread")
        if reader.exists():
            return str(reader)
    if shutil.which("dwgread"):
        return "dwgread"
    local_tool = BASE_DIR / "tools" / "libredwg" / ("dwgread.exe" if os.name == "nt" else "dwgread")
    if local_tool.exists():
        return str(local_tool)
    return None


def enhance_doc_from_dwg(doc, dwg_path: Path, timeout: int = 20) -> int:
    """Inject missing visible attributes from DWG directly into doc.modelspace().

    Returns the number of injected text entities.
    """
    dwgread_exe = _find_dwgread()
    if not dwgread_exe:
        log.warning("dwgread executable not found, skipping DXF enhancement")
        return 0

    with tempfile.TemporaryDirectory() as tmp_dir:
        json_path = Path(tmp_dir) / "dump.json"
        cmd = [dwgread_exe, "-O", "JSON", "-o", str(json_path), str(dwg_path)]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            if not json_path.exists() or json_path.stat().st_size == 0:
                log.warning("dwgread produced no JSON (rc=%s): %s", res.returncode, res.stderr[-300:])
                return 0
            json_text = json_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
            log.warning("dwgread JSON dump failed: %s", exc)
            return 0

    # Extract all ATTRIB entities via regex (robust against JSON nan)
    attrib_blocks = re.findall(r'\{\s*"entity":\s*"ATTRIB".*?\n    \}', json_text, re.DOTALL)
    if not attrib_blocks:
        return 0

    msp = doc.modelspace()

    # Index existing text entities and attribs in DXF with coordinates
    existing_text_points: dict[str, list[tuple[float, float]]] = {}

    def _index_text(t: str, e):
        t = t.strip()
        if not t:
            return
        pts = existing_text_points.setdefault(t, [])
        if hasattr(e.dxf, "insert"):
            pts.append((float(e.dxf.insert.x), float(e.dxf.insert.y)))
        if hasattr(e.dxf, "align_point") and e.dxf.hasattr("align_point"):
            try:
                pts.append((float(e.dxf.align_point.x), float(e.dxf.align_point.y)))
            except Exception:
                pass

    for e in msp:
        if e.dxftype() in ("TEXT", "MTEXT"):
            _index_text(e.dxf.text if e.dxftype() == "TEXT" else e.text, e)
        elif e.dxftype() == "INSERT":
            for a in e.attribs:
                _index_text(a.dxf.text, a)

    # Note: Only index actual modelspace entities, not block definitions in doc.blocks,
    # because block definitions are not rendered in modelspace unless an exploded or attribute-bearing insert exists.
    added_count = 0

    for ab in attrib_blocks:
        inv_m = re.search(r'"invisible":\s*(\d+)', ab)
        flags_m = re.search(r'"flags":\s*(\d+)', ab)
        val_m = re.search(r'"text_value":\s*"([^"]*)"', ab)
        tag_m = re.search(r'"tag":\s*"([^"]+)"', ab)

        inv = int(inv_m.group(1)) if inv_m else 0
        flags = int(flags_m.group(1)) if flags_m else 0
        val = val_m.group(1).strip() if val_m else ""
        tag = tag_m.group(1) if tag_m else ""

        # Skip invisible, flag bit 1 (invisible attribute), or empty values
        if (inv != 0) or bool(flags & 1) or not val:
            continue

        ins_m = re.search(r'"ins_pt":\s*\[\s*([\d.-]+),\s*([\d.-]+)', ab)
        align_m = re.search(r'"alignment_pt":\s*\[\s*([\d.-]+),\s*([\d.-]+)', ab)
        h_m = re.search(r'"height":\s*([\d.-]+)', ab)
        rot_m = re.search(r'"rotation":\s*([\d.-]+)', ab)
        color_m = re.search(r'"color":\s*(\d+)', ab)

        ins_pt = (float(ins_m.group(1)), float(ins_m.group(2))) if ins_m else (0.0, 0.0)
        align_pt = (float(align_m.group(1)), float(align_m.group(2))) if align_m else ins_pt
        height = float(h_m.group(1)) if h_m else 2.5
        rot_rad = float(rot_m.group(1)) if rot_m else 0.0
        rot_deg = math.degrees(rot_rad) % 360.0

        color = int(color_m.group(1)) if color_m else 7
        if color in (0, 256):
            color = 7

        # Semantic styling: RFID Tag numbers are magenta (6)
        if tag == "RFID_TAG_NO.":
            color = 6
        elif tag == "TYPE" or "LOCATION" in tag:
            color = 7

        # Skip if already rendered at or near this location (within 8 CAD units)
        is_dup = False
        if val in existing_text_points:
            for ex, ey in existing_text_points[val]:
                if math.hypot(align_pt[0] - ex, align_pt[1] - ey) < 8.0 or math.hypot(ins_pt[0] - ex, ins_pt[1] - ey) < 8.0:
                    is_dup = True
                    break
        if is_dup:
            continue

        try:
            txt_entity = msp.add_text(
                val,
                dxfattribs={
                    "insert": ins_pt,
                    "height": height,
                    "rotation": rot_deg,
                    "color": color,
                    "layer": "0",
                },
            )
            if align_pt != ins_pt:
                txt_entity.dxf.align_point = align_pt
                txt_entity.dxf.halign = 1  # Center
                txt_entity.dxf.valign = 2  # Middle
            added_count += 1
            existing_text_points.setdefault(val, []).append(align_pt)
            existing_text_points[val].append(ins_pt)
        except Exception:
            continue

    if added_count > 0:
        log.info("Enhanced CAD document with %d missing attributes from DWG", added_count)

    return added_count
