"""Track network graph builder using NetworkX for planar topological traversal."""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import networkx as nx

log = logging.getLogger("x_tractor.track_graph")


@dataclass
class TrackBand:
    level_id: int
    name: str  # Down Main, Up Main, Common Loop, Up Loop
    y_center: float
    min_x: float
    max_x: float
    segments: list[tuple[float, float, float, float]] = field(default_factory=list)


class TrackGraphBuilder:
    """Extracts track centerlines and turnout crossovers to construct a directed NetworkX graph."""

    @classmethod
    def build(cls, doc: Any) -> tuple[nx.DiGraph, list[TrackBand]]:
        msp = doc.modelspace()
        lines: list[tuple[float, float, float, float]] = []

        # Collect line & polyline segments representing tracks
        for entity in msp:
            dxftype = entity.dxftype()
            layer = getattr(entity.dxf, "layer", "").lower()

            # Filter for track layers or entities
            is_track_layer = any(t in layer for t in ("track", "rail", "line", "center", "layout", "0"))
            if not is_track_layer:
                continue

            if dxftype == "LINE":
                s = getattr(entity.dxf, "start", (0.0, 0.0))
                e = getattr(entity.dxf, "end", (0.0, 0.0))
                lines.append((float(s[0]), float(s[1]), float(e[0]), float(e[1])))

            elif dxftype in ("LWPOLYLINE", "POLYLINE"):
                pts = list(entity.vertices() if dxftype == "POLYLINE" else entity.get_points())
                for i in range(len(pts) - 1):
                    p1 = pts[i]
                    p2 = pts[i + 1]
                    lines.append((float(p1[0]), float(p1[1]), float(p2[0]), float(p2[1])))

        # Cluster horizontal lines into track levels by Y-coordinate
        h_lines = [l for l in lines if abs(l[3] - l[1]) <= 5.0 and abs(l[2] - l[0]) >= 20.0]
        y_coords = [(l[1] + l[3]) / 2.0 for l in h_lines]

        clusters: list[list[float]] = []
        for y in sorted(y_coords):
            placed = False
            for c in clusters:
                if abs(y - (sum(c) / len(c))) <= 8.0:
                    c.append(y)
                    placed = True
                    break
            if not placed:
                clusters.append([y])

        # Form Track Bands (typically 2 to 6 tracks: Down Main, Up Main, Loops, Sidings)
        bands: list[TrackBand] = []
        # Sort bands descending by Y (standard CAD layout: Down Main top, Up Main bottom)
        clusters.sort(key=lambda c: sum(c) / len(c), reverse=True)

        track_names_palette = ["Common Loop", "Down Main", "Up Main", "Up Loop", "Siding 1", "Siding 2"]
        if len(clusters) == 2:
            track_names_palette = ["Down Main", "Up Main"]
        elif len(clusters) == 3:
            track_names_palette = ["Down Main", "Up Main", "Up Loop"]
        elif len(clusters) == 4:
            track_names_palette = ["Common Loop", "Down Main", "Up Main", "Up Loop"]

        for idx, c in enumerate(clusters):
            y_avg = sum(c) / len(c)
            band_lines = [l for l in h_lines if abs(((l[1] + l[3]) / 2.0) - y_avg) <= 8.0]
            if not band_lines:
                continue
            min_x = min(min(l[0], l[2]) for l in band_lines)
            max_x = max(max(l[0], l[2]) for l in band_lines)
            name = track_names_palette[idx] if idx < len(track_names_palette) else f"Track {idx+1}"
            bands.append(TrackBand(
                level_id=idx,
                name=name,
                y_center=y_avg,
                min_x=min_x,
                max_x=max_x,
                segments=band_lines
            ))

        # Build NetworkX DiGraph
        G = nx.DiGraph()

        # Add primary track lines to graph
        for band in bands:
            # Nominal (West to East / Left to Right)
            start_node = (round(band.min_x, 1), round(band.y_center, 1))
            end_node = (round(band.max_x, 1), round(band.y_center, 1))
            length = band.max_x - band.min_x
            G.add_edge(start_node, end_node, weight=length, track=band.name, direction="Nominal")
            # Reverse (East to West / Right to Left)
            G.add_edge(end_node, start_node, weight=length, track=band.name, direction="Reverse")

        # Add crossover diagonal turnouts
        diag_lines = [l for l in lines if abs(l[3] - l[1]) > 5.0 and math.hypot(l[2] - l[0], l[3] - l[1]) >= 15.0]
        for dl in diag_lines:
            p1 = (round(dl[0], 1), round(dl[1], 1))
            p2 = (round(dl[2], 1), round(dl[3], 1))
            dist = math.hypot(dl[2] - dl[0], dl[3] - dl[1])
            G.add_edge(p1, p2, weight=dist, track="Crossover", is_turnout=True)
            G.add_edge(p2, p1, weight=dist, track="Crossover", is_turnout=True)

        log.info("Built track graph: %d nodes, %d edges across %d track levels",
                 G.number_of_nodes(), G.number_of_edges(), len(bands))
        return G, bands
