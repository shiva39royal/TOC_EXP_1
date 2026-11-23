"""Generator for Temporary Single Line (TSL) Working on Double Line Table."""
from __future__ import annotations

import logging
from typing import Any

from app.x_tractor.models.infrastructure import StationMeta
from app.x_tractor.models.route import RouteItem
from app.x_tractor.models.kavach_tables import TslWorkingRow

log = logging.getLogger("x_tractor.tsl_generator")


class TslGenerator:
    """Synthesizes KAVACH TSL Working rows per RDSO Specification Clause I.2.12.7."""

    @classmethod
    def generate(
        cls,
        routes: list[RouteItem],
        station_meta: StationMeta
    ) -> list[TslWorkingRow]:
        tsl_rows: list[TslWorkingRow] = []

        # TSL routes are operational routes adapted for emergency single-line working
        for r in routes[:6]:
            cmd = f"{r.s_no}GNR, CLUNR" if "Loop" in r.line else f"{r.s_no}GNR, 30GNR"
            seq_str = ", ".join(f"({d}, {t})" for d, t in r.rfid_sequence) if r.rfid_sequence else "-"

            tsl_rows.append(TslWorkingRow(
                tsl_entry_signal=r.entry_signal,
                tsl_exit_signal=r.exit_signal,
                signal_type=r.signal_type,
                aspect_entry_signal="Red/Blank",
                requires_aspect_exit_signal="Red",
                required_route_command=cmd,
                points_normal=", ".join(r.normal_points) if r.normal_points else "-",
                points_reverse=", ".join(r.reverse_points) if r.reverse_points else "-",
                requires_track_ckt_up="Axle Counter section free",
                tins_requires_free=", ".join(r.required_tins) if r.required_tins else "-",
                entry_signal_foot_tag=r.entry_foot_tag or "-",
                rfid_sequence_str=seq_str,
                distance_between_signals_m=r.distance_m,
                movement_authority="1",
                authorized_speed_os="25/booked speed"
            ))

        log.info("Generated %d TSL Working rows", len(tsl_rows))
        return tsl_rows
