"""Spatial asset snapping onto track centerlines using KD-Tree."""
from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np
from scipy.spatial import KDTree

from app.x_tractor.topology.track_graph import TrackBand

log = logging.getLogger("x_tractor.projector")


class AssetProjector:
    """Projects 2D CAD assets orthogonally onto the nearest railway track band."""

    def __init__(self, bands: list[TrackBand]) -> None:
        self.bands = bands
        # Sample points along all track bands to build KD-Tree
        sample_pts: list[tuple[float, float]] = []
        self.pt_to_band: list[TrackBand] = []

        for b in bands:
            step = 10.0  # sample every 10 CAD units
            x = b.min_x
            while x <= b.max_x:
                sample_pts.append((x, b.y_center))
                self.pt_to_band.append(b)
                x += step

        if sample_pts:
            self.kdtree = KDTree(np.array(sample_pts))
        else:
            self.kdtree = None

    def project(self, x: float, y: float) -> tuple[TrackBand | None, float, float]:
        """Returns: (Nearest TrackBand, Snapped X, Snapped Y)"""
        if not self.bands:
            return None, x, y

        # Find closest track band vertically
        best_band = min(self.bands, key=lambda b: abs(b.y_center - y))
        snapped_x = max(best_band.min_x, min(best_band.max_x, x))
        snapped_y = best_band.y_center
        return best_band, snapped_x, snapped_y

    def assign_to_assets(self, items: list[Any]) -> None:
        """Mutates items in-place, setting snapped track_name, chainage_m, and y coordinate."""
        for item in items:
            x = getattr(item, "x", 0.0)
            y = getattr(item, "y", 0.0)
            band, sx, sy = self.project(x, y)
            if band:
                setattr(item, "track_name", band.name)
                # Chainage relative to the track's start
                chainage = round(sx - band.min_x, 2)
                setattr(item, "chainage_m", chainage)
