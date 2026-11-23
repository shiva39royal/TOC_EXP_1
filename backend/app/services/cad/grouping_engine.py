"""Geometry Grouping Engine for Exploded Railway CAD Primitives.

Identifies loose CAD entities (lines, polylines, circles, text annotations)
that form composite railway signaling components:
- Signal Assemblies (vertical mast + aspect circles + bracket/arrow)
- Axle Counter Detection Points (concentric or tangent circles + DP labels)
- RFID Tag Assemblies (chevron triangle / hatch + R-xxx tag number)
- Points and Crossovers (switch lines + point machine labels)
"""
from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("cad.grouping")


@dataclass
class GeometricPrimitive:
    handle: str
    dxftype: str
    layer: str
    color: str
    bbox: list[float]  # [min_x, min_y, max_x, max_y]
    center: list[float]  # [cx, cy]
    text: str = ""
    radius: float = 0.0
    tags: dict[str, str] = field(default_factory=dict)
    raw_entity: Any = None


@dataclass
class GroupedComponent:
    group_id: str
    category_key: str
    category_id: int
    name: str
    bbox: list[float]
    anchor: list[float]
    member_handles: list[str]
    tags: dict[str, str]
    confidence: float


class GeometryGroupingEngine:
    """Clusters loose CAD primitives into semantic railway components."""

    def __init__(self, proximity_threshold: float = 25.0) -> None:
        self.proximity_threshold = proximity_threshold

    @staticmethod
    def bbox_distance(b1: list[float], b2: list[float]) -> float:
        """Euclidean distance between two bounding boxes (0 if overlapping)."""
        dx = max(0.0, max(b1[0] - b2[2], b2[0] - b1[2]))
        dy = max(0.0, max(b1[1] - b2[3], b2[1] - b1[3]))
        return math.hypot(dx, dy)

    @staticmethod
    def merge_bboxes(boxes: list[list[float]]) -> list[float]:
        if not boxes:
            return [0.0, 0.0, 0.0, 0.0]
        return [
            round(min(b[0] for b in boxes), 4),
            round(min(b[1] for b in boxes), 4),
            round(max(b[2] for b in boxes), 4),
            round(max(b[3] for b in boxes), 4),
        ]

    def group_axle_counters(
        self,
        circles: list[GeometricPrimitive],
        texts: list[GeometricPrimitive],
    ) -> list[GroupedComponent]:
        """Detects axle counter wheel sensors (tangent/concentric circles with DP labels)."""
        grouped: list[GroupedComponent] = []
        used_circles: set[str] = set()
        used_texts: set[str] = set()

        # Find circle pairs with centers close together (< 15 units)
        for i, c1 in enumerate(circles):
            if c1.handle in used_circles:
                continue
            pair = [c1]
            for j in range(i + 1, len(circles)):
                c2 = circles[j]
                if c2.handle in used_circles:
                    continue
                dist = math.hypot(c1.center[0] - c2.center[0], c1.center[1] - c2.center[1])
                if dist <= 15.0 and abs(c1.radius - c2.radius) < 5.0:
                    pair.append(c2)
                    used_circles.add(c2.handle)
                    break

            if len(pair) >= 1:
                used_circles.add(c1.handle)
                box = self.merge_bboxes([p.bbox for p in pair])
                anc = [(box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0]

                # Look for matching DP text nearby
                dp_name = ""
                matched_text_handle = ""
                for t in texts:
                    if t.handle in used_texts:
                        continue
                    m = re.match(r"^DP\s*(\d{1,2}[A-Z]?)$", t.text.strip(), re.IGNORECASE)
                    if m:
                        t_dist = math.hypot(anc[0] - t.center[0], anc[1] - t.center[1])
                        if t_dist <= self.proximity_threshold:
                            dp_name = f"DP{m.group(1).upper()}"
                            matched_text_handle = t.handle
                            used_texts.add(t.handle)
                            box = self.merge_bboxes([box, t.bbox])
                            break

                handles = [p.handle for p in pair]
                if matched_text_handle:
                    handles.append(matched_text_handle)

                comp_name = f"Axle Counters: Detection Point ({dp_name or 'DP'})"
                grouped.append(GroupedComponent(
                    group_id=f"grp_ac_{c1.handle}",
                    category_key="axle_counters",
                    category_id=4,
                    name=comp_name,
                    bbox=box,
                    anchor=anc,
                    member_handles=handles,
                    tags={"TYPE": "AXLE_COUNTER", "DP_NO": dp_name, "NAME": dp_name},
                    confidence=0.90 if dp_name else 0.70,
                ))

        return grouped

    def group_rfid_tags(
        self,
        primitives: list[GeometricPrimitive],
        texts: list[GeometricPrimitive],
    ) -> list[GroupedComponent]:
        """Correlates RFID chevron/symbol primitives with R-xxx tag texts."""
        grouped: list[GroupedComponent] = []
        used_prims: set[str] = set()
        used_texts: set[str] = set()

        for t in texts:
            m = re.match(r"^R-?(\d{2,4})$", t.text.strip(), re.IGNORECASE)
            if not m:
                continue

            tag_no = f"R-{m.group(1)}"
            nearby_prims = []
            for p in primitives:
                if p.handle in used_prims:
                    continue
                dist = math.hypot(t.center[0] - p.center[0], t.center[1] - p.center[1])
                if dist <= self.proximity_threshold:
                    nearby_prims.append(p)

            if nearby_prims:
                for p in nearby_prims:
                    used_prims.add(p.handle)
                used_texts.add(t.handle)

                all_boxes = [p.bbox for p in nearby_prims] + [t.bbox]
                box = self.merge_bboxes(all_boxes)
                anc = [(box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0]

                handles = [p.handle for p in nearby_prims] + [t.handle]
                grouped.append(GroupedComponent(
                    group_id=f"grp_rfid_{t.handle}",
                    category_key="rfid_tags",
                    category_id=3,
                    name=f"RFID Tags: Tag ({tag_no})",
                    bbox=box,
                    anchor=anc,
                    member_handles=handles,
                    tags={"TYPE": "RFID_TAG", "RFID_TAG_NO.": tag_no, "TAG_NO": tag_no},
                    confidence=0.92,
                ))

        return grouped

