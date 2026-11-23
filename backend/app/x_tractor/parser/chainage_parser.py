"""Parser and calculator for chainages, distances, and RDSO engineering gradients."""
from __future__ import annotations

import logging
import math
import re
from typing import Any
from app.x_tractor.models.infrastructure import GradientSegment

log = logging.getLogger("x_tractor.chainage_parser")


class ChainageParser:
    """Parses kilometer chainages, ruler measurements, and computes RDSO harmonic average gradients."""

    @staticmethod
    def parse_chainage_text(text: str) -> float | None:
        """Parses strings like '128.660', '128/21-23', 'TO-129.411' into metric kilometer floats."""
        if not text:
            return None
        # Standard decimal km: 128.660
        m = re.search(r"\b(\d{2,4}\.\d{2,4})\b", text)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
        # Railway pole notation: 128/21 or 128/21-23
        m2 = re.search(r"\b(\d{2,4})\/(\d{1,2})", text)
        if m2:
            try:
                km = float(m2.group(1))
                pole = float(m2.group(2))
                return km + (pole * 0.05)  # approximate 50m per pole if needed
            except ValueError:
                pass
        return None

    @staticmethod
    def parse_engineering_gradients(raw_text: str) -> list[GradientSegment]:
        """Parses gradient strings like:
        '(R 1 in 150, 297), (Level, 552), (F 1 in 150, 174)'
        or '1 in -1000, 190'
        """
        segments: list[GradientSegment] = []
        if not raw_text:
            return segments

        # Regex for '(R/F 1 in X, length)' or '(Level, length)'
        pattern = re.compile(
            r"\((?:([RF])\s+1\s+in\s+([-\d]+)|(LEVEL))\s*,\s*([\d\.]+)\)",
            re.IGNORECASE
        )
        cur_m = 0.0
        for match in pattern.finditer(raw_text):
            dir_letter = match.group(1)
            ratio_str = match.group(2)
            is_level = bool(match.group(3))
            length = float(match.group(4))

            if is_level:
                segments.append(GradientSegment(
                    start_m=cur_m,
                    end_m=cur_m + length,
                    length_m=length,
                    grad_type="LEVEL",
                    ratio=0.0,
                    raw_text=match.group(0)
                ))
            else:
                ratio = abs(float(ratio_str))
                grad_type = "R" if (dir_letter and dir_letter.upper() == "R") else "F"
                segments.append(GradientSegment(
                    start_m=cur_m,
                    end_m=cur_m + length,
                    length_m=length,
                    grad_type=grad_type,
                    ratio=ratio,
                    raw_text=match.group(0)
                ))
            cur_m += length

        return segments

    @classmethod
    def calculate_rdso_average_gradient(cls, segments: list[GradientSegment]) -> tuple[str, float]:
        """Calculates RDSO Weighted Harmonic Average Gradient per Specification Clause I.2.13.3 (b)(i):
        Average Gradient G = D / (d1/g1 + d2/g2 + ... + dn/gn)
        where D = sum(di), gi is the gradient ratio (e.g. 150 for 1 in 150).
        Level sections contribute 0 to the denominator.
        Returns: (Average Gradient String e.g. 'R 1 in 198', Total Length in meters)
        """
        if not segments:
            return "LEVEL", 0.0

        total_d = sum(s.length_m for s in segments)
        if total_d <= 0:
            return "LEVEL", 0.0

        denom = 0.0
        r_dist = 0.0
        f_dist = 0.0

        for s in segments:
            if s.grad_type == "R" and s.ratio > 0:
                denom += s.length_m / s.ratio
                r_dist += s.length_m
            elif s.grad_type == "F" and s.ratio > 0:
                denom += s.length_m / s.ratio
                f_dist += s.length_m

        if denom <= 0:
            return "LEVEL", total_d

        g_avg = round(total_d / denom)
        dominant_dir = "R" if r_dist >= f_dist else "F"
        return f"{dominant_dir} 1 in {g_avg}", total_d
