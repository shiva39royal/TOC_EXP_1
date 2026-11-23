"""Generic entity classifier for CAD railway elements.
Extracts strongly-typed signaling items without hardcoded station-specific constants.
Enforces the Strict Zero Hardcoding Policy.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Any

from app.x_tractor.models.infrastructure import (
    SignalItem, PointItem, TinItem, RfidTagItem, LCGateItem, OhePoleItem, TrackConditionItem
)

log = logging.getLogger("x_tractor.classifier")


class EntityClassifier:
    """Classifies DXF modelspace entities into railway infrastructure domain models."""

    @classmethod
    def extract_all(cls, doc: Any, dwg_path: Any = None) -> dict[str, list[Any] | list[tuple[str, str]]]:
        signals: list[SignalItem] = []
        points: list[PointItem] = []
        tins: list[TinItem] = []
        rfid_tags: list[RfidTagItem] = []
        lc_gates: list[LCGateItem] = []
        ohe_poles: list[OhePoleItem] = []
        track_conditions: list[TrackConditionItem] = []
        declared_routes: list[tuple[str, str]] = []

        seen_signals: set[str] = set()
        seen_points: set[str] = set()
        seen_tins: set[str] = set()
        seen_tags: set[str] = set()
        seen_declared_routes: set[tuple[str, str]] = set()

        msp = doc.modelspace()

        # Step 1: Scan modelspace entities
        for entity in msp:
            dxftype = entity.dxftype()
            layer = getattr(entity.dxf, "layer", "")
            layer_upper = layer.upper()

            if dxftype in ("TEXT", "MTEXT"):
                raw_text = getattr(entity.dxf, "text", "") if dxftype == "TEXT" else getattr(entity, "text", "")
                clean = cls._clean_text(raw_text)
                if not clean:
                    continue
                pos = getattr(entity.dxf, "insert", (0.0, 0.0, 0.0))
                x, y = float(pos[0]), float(pos[1])
                handle = str(getattr(entity.dxf, "handle", ""))

                # Check RFID Tag (e.g. R-514, R-666, R-452, R-696-F, R156)
                rfid_m = re.match(r"^(R[-_ ]?\d+[A-Z\-]*)", clean, re.IGNORECASE)
                if rfid_m:
                    tag_no = rfid_m.group(1).upper().replace("_", "-").replace(" ", "-")
                    if tag_no not in seen_tags:
                        seen_tags.add(tag_no)
                        is_fm = "-F" in tag_no or "FOULING" in clean.upper() or "FM" in clean.upper()
                        is_border = "BORDER" in clean.upper()
                        rfid_tags.append(RfidTagItem(
                            id=f"tag_{len(rfid_tags)+1}",
                            tag_no=tag_no,
                            x=x, y=y,
                            is_fouling_mark=is_fm,
                            is_border_tag=is_border,
                            handle=handle
                        ))
                    continue

                # Check TIN notation: (N-62), (N-64), (N-90), (N-91), (T-10), N-62
                tin_m = re.search(r"\(?\b([NT][-_ ]?\d{1,3})\b\)?", clean, re.IGNORECASE)
                if tin_m and not re.match(r"^R[-_ ]", clean, re.IGNORECASE):
                    tin_no = tin_m.group(1).upper().replace("_", "-").replace(" ", "-")
                    if tin_no not in seen_tins:
                        seen_tins.add(tin_no)
                        tins.append(TinItem(
                            id=f"tin_{len(tins)+1}",
                            name=tin_no,
                            min_x=x - 50.0,
                            max_x=x + 50.0,
                            y=y,
                            is_block_section=False,
                            handle=handle
                        ))
                    continue

                # Check Signal Names: e.g. S1, S01, S02, S03, S05, S06, S08, S09, S3323, S3423, S8450, SH9, SH10, C01, C02, S1 D, S1 ID
                # Strictly reject compound strings with hyphens/periods (e.g. S1-S4., S25-S1946.)
                if not re.search(r"-\s*S\d", clean) and not re.search(r"\.\s*S\d", clean):
                    sig_m = re.match(r"^(S\d{1,4}[A-Z]?|SH\d{1,3}|C\d{1,3}|S\d{1,4}\s*(?:ID|D|A)?)$", clean, re.IGNORECASE)
                    if sig_m:
                        sig_name = sig_m.group(1).upper().strip()
                        # Clean space formatting
                        sig_name = re.sub(r"^S(\d+)(ID|D|A)$", r"S\1 \2", sig_name)
                        if sig_name not in seen_signals:
                            seen_signals.add(sig_name)
                            stype = cls._infer_signal_type(sig_name, clean)
                            # Direction derived from layer, rotation, or signal type
                            direction = "Reverse" if any(r in layer_upper for r in ("REV", "UP")) else "Nominal"
                            signals.append(SignalItem(
                                id=f"sig_{len(signals)+1}",
                                name=sig_name,
                                signal_type=stype,
                                is_entry=True,
                                is_exit=True,
                                is_lss="ADV" in stype.upper() or "LSS" in stype.upper(),
                                x=x, y=y,
                                direction=direction,
                                aspects=["Green", "Double Yellow", "Yellow", "Red"],
                                handle=handle
                            ))
                        continue

                # Check Point Machine: P11, P12, P13, P18, P19, P20, P10A, P10B, P12A
                pt_m = re.match(r"^P[-_ ]?(\d{1,3}[A-Z]?)\b", clean, re.IGNORECASE)
                if pt_m:
                    pt_name = f"P-{pt_m.group(1).upper()}"
                    if pt_name not in seen_points:
                        seen_points.add(pt_name)
                        points.append(PointItem(
                            id=f"pt_{len(points)+1}",
                            name=pt_name,
                            x=x, y=y,
                            handle=handle
                        ))
                    continue

                # Check Level Crossing Gate: LC.No.19, LC 19, LC NO 22
                lc_m = re.search(r"LC[\.\s]*No[\.\s]*(\d+[A-Z]?)", clean, re.IGNORECASE)
                if lc_m:
                    lc_no = lc_m.group(1).upper()
                    class_m = re.search(r"['\"]?([A-D]|SPECIAL)['\"]?\s*CLASS", clean, re.IGNORECASE)
                    c_type = class_m.group(1).upper() if class_m else "C"
                    manned = "Manned" if "MANNED" in clean.upper() else ("Unmanned" if "UNMANNED" in clean.upper() else "Manned")
                    lc_gates.append(LCGateItem(
                        id=f"lc_{len(lc_gates)+1}",
                        name=f"LC No. {lc_no}",
                        lc_no=lc_no,
                        class_type=c_type,
                        manning_type=manned,
                        x=x, y=y,
                        handle=handle
                    ))
                    continue

                # Check OHE Mast / Pole: e.g. 122/34, 122/36, 128/19
                ohe_m = re.match(r"^(\d{2,4})\/(\d{1,3})$", clean)
                if ohe_m:
                    mast_id = clean
                    ohe_poles.append(OhePoleItem(
                        mast_id=mast_id,
                        x=x, y=y
                    ))
                    continue

                # Check Fouling Mark text: e.g. "FM 128.394", "FM 129.111"
                if "FM" in clean.upper() or "FOULING" in clean.upper():
                    track_conditions.append(TrackConditionItem(
                        cond_type="Fouling Mark",
                        x=x, y=y,
                        description=clean
                    ))

            elif dxftype == "INSERT":
                # Check attributes inside block insertions
                b_name = getattr(entity.dxf, "name", "")
                pos = getattr(entity.dxf, "insert", (0.0, 0.0, 0.0))
                x, y = float(pos[0]), float(pos[1])
                handle = str(getattr(entity.dxf, "handle", ""))

                for attrib in getattr(entity, "attribs", []):
                    tag = getattr(attrib.dxf, "tag", "").upper().strip()
                    val = cls._clean_text(getattr(attrib.dxf, "text", ""))
                    if not val:
                        continue

                    # 1. Parse declared routes from ROUTES attribute (e.g. "S1-S4. S27-S25. S28-S25.")
                    if "ROUTE" in tag:
                        pairs = re.findall(r"([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)", val)
                        for e_str, x_str in pairs:
                            e_u = e_str.upper()
                            x_u = x_str.upper()
                            # Filter out single-letter fragments like S-S
                            if e_u != x_u and (len(e_u) > 1 or len(x_u) > 1):
                                pair = (e_u, x_u)
                                if pair not in seen_declared_routes:
                                    seen_declared_routes.add(pair)
                                    declared_routes.append(pair)
                        continue

                    # 2. Parse RFID tags
                    if tag in ("RFID_TAG_NO", "RFID_NO", "TAG_NO") or re.match(r"^R[-_ ]?\d+", val):
                        tag_no = val.upper().replace("_", "-").replace(" ", "-")
                        if tag_no not in seen_tags:
                            seen_tags.add(tag_no)
                            rfid_tags.append(RfidTagItem(
                                id=f"tag_{len(rfid_tags)+1}",
                                tag_no=tag_no,
                                x=x, y=y,
                                handle=handle
                            ))
                        continue

                    # 3. Parse Signal from dedicated signal tags (NOT route annotations)
                    if tag in ("SIGNAL_NO", "SIG_NO", "SIGNAL_NAME", "SIG") and not re.search(r"-\s*S\d", val):
                        sig_name = val.upper().strip()
                        if sig_name not in seen_signals:
                            seen_signals.add(sig_name)
                            stype = cls._infer_signal_type(sig_name, val)
                            direction = "Reverse" if any(r in layer_upper for r in ("REV", "UP")) else "Nominal"
                            signals.append(SignalItem(
                                id=f"sig_{len(signals)+1}",
                                name=sig_name,
                                signal_type=stype,
                                is_entry=True,
                                is_exit=True,
                                is_lss="ADV" in stype.upper() or "LSS" in stype.upper(),
                                x=x, y=y,
                                direction=direction,
                                aspects=["Green", "Double Yellow", "Yellow", "Red"],
                                handle=handle
                            ))
                        continue

                    # 4. Parse Point from point tags
                    if tag in ("POINT_NO", "PT_NO", "SWITCH_NO"):
                        pt_name = f"P-{re.sub(r'^P[-_ ]?', '', val).upper()}"
                        if pt_name not in seen_points:
                            seen_points.add(pt_name)
                            points.append(PointItem(
                                id=f"pt_{len(points)+1}",
                                name=pt_name,
                                x=x, y=y,
                                handle=handle
                            ))
                        continue

                    # 5. Parse TIN from TIN_NO tags
                    if tag in ("TIN_NO", "TIN", "TIN_NUMBER"):
                        tin_m = re.search(r"\(?\b([NT][-_ ]?\d{1,3})\b\)?", val, re.IGNORECASE)
                        if tin_m:
                            tin_no = tin_m.group(1).upper().replace("_", "-").replace(" ", "-")
                            if tin_no not in seen_tins:
                                seen_tins.add(tin_no)
                                tins.append(TinItem(
                                    id=f"tin_{len(tins)+1}",
                                    name=tin_no,
                                    min_x=x - 50.0,
                                    max_x=x + 50.0,
                                    y=y,
                                    is_block_section=False,
                                    handle=handle
                                ))

        # Sort elements by X coordinate (geographic order along station)
        signals.sort(key=lambda s: s.x)
        points.sort(key=lambda p: p.x)
        rfid_tags.sort(key=lambda t: t.x)
        tins.sort(key=lambda t: t.min_x)
        ohe_poles.sort(key=lambda p: p.x)

        # Associate foot tags with nearest signal
        for sig in signals:
            nearest_tag = None
            min_d = float("inf")
            for tag in rfid_tags:
                d = math.hypot(tag.x - sig.x, tag.y - sig.y)
                if d < min_d:
                    min_d = d
                    nearest_tag = tag
            # If within 35 CAD units, bind as foot tag
            if nearest_tag and min_d <= 35.0:
                sig.foot_tag = nearest_tag.tag_no
                nearest_tag.is_foot_tag = True
                nearest_tag.associated_signal = sig.name

        log.info("Classified: %d signals, %d points, %d TINs, %d RFID tags, %d LC gates, %d OHE poles, %d declared routes",
                 len(signals), len(points), len(tins), len(rfid_tags), len(lc_gates), len(ohe_poles), len(declared_routes))

        return {
            "signals": signals,
            "points": points,
            "tins": tins,
            "rfid_tags": rfid_tags,
            "lc_gates": lc_gates,
            "ohe_poles": ohe_poles,
            "track_conditions": track_conditions,
            "declared_routes": declared_routes
        }

    @staticmethod
    def _clean_text(raw: str) -> str:
        if not raw:
            return ""
        t = re.sub(r"\{[^\}]*\}", "", raw)
        t = re.sub(r"\\[A-Za-z0-9]+;?", " ", t)
        return t.strip()

    @staticmethod
    def _infer_signal_type(name: str, raw_text: str = "") -> str:
        """Infers the engineering signal type per strict Indian Railways rules."""
        u = (name + " " + raw_text).upper().strip()
        # Rule 1: Ends with ID -> Inner Distant
        if u.endswith("ID") or " ID" in u or "INNER" in u:
            return "Inner Distant"
        # Rule 2: Ends with D -> Distant Signal
        if u.endswith("D") or " D" in u or "DIST" in u:
            return "Distant Signal"
        # Rule 3: Ends with A -> Calling-on Signal
        if u.endswith("A") or " A" in u or "CALL" in u:
            return "Calling-on Signal"
        # Rule 4: Loop line signals -> Starter / Adv Starter
        if "LOOP" in u:
            if "ADV" in u or "LSS" in u:
                return "Adv Starter"
            return "Starter"
        # Rule 5: Main line remaining signals -> Home Signal
        if "ADV" in u or "LSS" in u:
            return "Adv Starter"
        if "STARTER" in u:
            return "Starter"
        return "Home Signal"
