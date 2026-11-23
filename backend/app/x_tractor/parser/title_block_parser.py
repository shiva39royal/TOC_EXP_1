"""Generic parser for AutoCAD sheet title blocks, drawing metadata, and station headers.
Zero hardcoding: dynamically extracts station metadata using structural heuristics and regexes.
"""
from __future__ import annotations

import logging
import re
from typing import Any
from app.x_tractor.models.infrastructure import StationMeta

log = logging.getLogger("x_tractor.title_parser")


class TitleBlockParser:
    """Extracts station identity, chainages, and approval references from CAD drawing entities."""

    @classmethod
    def parse(cls, doc: Any, file_name: str = "") -> StationMeta:
        meta = StationMeta()
        all_texts: list[str] = []

        # Collect text from modelspace & paper layouts
        for entity in doc.modelspace():
            dxftype = entity.dxftype()
            if dxftype in ("TEXT", "MTEXT"):
                txt = getattr(entity.dxf, "text", "")
                if txt:
                    clean = re.sub(r"\{[^\}]*\}", "", txt).strip()
                    clean = re.sub(r"\\[A-Za-z0-9]+;?", " ", clean).strip()
                    if clean:
                        all_texts.append(clean)
            elif dxftype == "INSERT":
                # Check attributes inside block insertions (title block)
                for attrib in getattr(entity, "attribs", []):
                    t = getattr(attrib.dxf, "text", "")
                    if t:
                        all_texts.append(t.strip())

        joined = "\n".join(all_texts)

        # 1. Station ID: "Station ID: 521", "Station ID:521", "ST_ID: 101"
        id_m = re.search(r"Station\s*ID\s*[:\-=]\s*(\d+)", joined, re.IGNORECASE)
        if id_m:
            meta.station_id = id_m.group(1).strip()
        elif "STATION" in joined.upper():
            alt_id = re.search(r"ID\s*[:\-=]\s*(\d{2,4})", joined, re.IGNORECASE)
            if alt_id:
                meta.station_id = alt_id.group(1).strip()

        # 2. Station Name and Alpha Code: e.g. "GULLAGUDA (GGD)", "CHITGIDDA (CTF)", "STATION: SECUNDERABAD"
        stn_m = re.search(r"Station\s*Name\s*[:\-=]\s*([A-Za-z0-9\-\s\(\)]+)", joined, re.IGNORECASE)
        if stn_m:
            candidate = stn_m.group(1).split("\n")[0].strip()
            cls._apply_station_string(candidate, meta)
        else:
            # Look for large text headers like "GULLAGUDA (GGD)"
            header_m = re.search(r"([A-Z]{3,20}\s*\([A-Z]{2,5}\))", joined)
            if header_m:
                cls._apply_station_string(header_m.group(1), meta)
            else:
                # Infer from filename e.g. "0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg"
                base = file_name.rsplit(".", 1)[0]
                m_fn = re.search(r"Stations?_([A-Za-z0-9_\-]+)", base, re.IGNORECASE)
                if m_fn:
                    meta.station_name = m_fn.group(1).replace("_", " ").upper()
                else:
                    meta.station_name = base.replace("_", " ").upper()

        # 3. Kilometer Chainage: e.g. "km : 128.660", "KM:128/21-23"
        km_m = re.search(r"km\s*[:\-=]\s*([\d\.]+)", joined, re.IGNORECASE)
        if km_m:
            try:
                meta.chainage_km = float(km_m.group(1))
            except Exception:
                pass

        # 4. Section: e.g. "Section: LPI-VKB", "Section: SC Railway"
        sec_m = re.search(r"Section\s*[:\-=]\s*([A-Za-z0-9\-\s\/]+)", joined, re.IGNORECASE)
        if sec_m:
            meta.section = sec_m.group(1).split("\n")[0].strip()

        # 5. Division: e.g. "Division: SECUNDERABAD"
        div_m = re.search(r"Division\s*[:\-=]\s*([A-Za-z0-9\-\s]+)", joined, re.IGNORECASE)
        if div_m:
            meta.division = div_m.group(1).split("\n")[0].strip()

        # 6. References (SIP, TOC, RFID Tag Layout)
        sip_m = re.search(r"SIP\s*NO?\s*[:\-=]\s*([A-Za-z0-9\.\-\_\/]+)", joined, re.IGNORECASE)
        if sip_m:
            meta.sip_no = sip_m.group(1).split("\n")[0].strip()

        toc_m = re.search(r"TOC\s*[:\-=]\s*([A-Za-z0-9\.\-\_\/]+)", joined, re.IGNORECASE)
        if toc_m:
            meta.toc_no = toc_m.group(1).split("\n")[0].strip()

        rfid_layout_m = re.search(r"(?:RFID_TAG_LAYOUT|RFID_TAG\/TIN_LAYOUT)[A-Za-z0-9\.\_\-]+", joined)
        if rfid_layout_m:
            meta.rfid_layout_no = rfid_layout_m.group(0).strip()

        # 7. Version: "Rev No. 0", "Version 2.0.2", "X.Y.Z"
        v_m = re.search(r"Version\s*[:\-=]?\s*(\d+\.\d+\.?\d*)", joined, re.IGNORECASE)
        if v_m:
            meta.version = v_m.group(1).strip()

        log.info("Parsed Station: %s (ID: %s, Sec: %s, Div: %s)", meta.station_name, meta.station_id, meta.section, meta.division)
        return meta

    @staticmethod
    def _apply_station_string(cand: str, meta: StationMeta) -> None:
        cand = cand.strip()
        code_m = re.search(r"\(([A-Z]{2,5})\)", cand)
        if code_m:
            meta.station_code = code_m.group(1)
            name_part = re.sub(r"\([A-Z]{2,5}\)", "", cand).strip()
            meta.station_name = name_part if name_part else cand
        else:
            meta.station_name = cand
