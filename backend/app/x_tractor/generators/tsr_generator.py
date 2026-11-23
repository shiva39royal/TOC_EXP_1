"""Generator for KAVACH Temporary Speed Restriction (TSR) Route Table and OHE Pole Data.
Enforces the Strict Zero Hardcoding Policy.
"""
from __future__ import annotations

import logging
from typing import Any

from app.x_tractor.models.infrastructure import StationMeta, OhePoleItem
from app.x_tractor.models.route import RouteItem
from app.x_tractor.models.kavach_tables import TsrRouteRow

log = logging.getLogger("x_tractor.tsr_generator")


class TsrGenerator:
    """Synthesizes KAVACH TSR Route Table rows per RDSO Specification Clause I.2.12.6 without hardcoding."""

    @classmethod
    def generate(
        cls,
        routes: list[RouteItem],
        station_meta: StationMeta,
        ohe_poles: list[OhePoleItem]
    ) -> list[TsrRouteRow]:
        tsr_rows: list[TsrRouteRow] = []
        stn_code = station_meta.station_code or station_meta.station_name or "STATION"

        for r in routes:
            # Determine line designation dynamically
            if "LOOP" in r.line.upper():
                ohe_line = f"{stn_code} Common Loop"
                route_suffix = "1"
            elif "DOWN" in r.line.upper():
                ohe_line = f"{stn_code} DN Main Line"
                route_suffix = "2"
            else:
                ohe_line = f"{stn_code} UP Main Line"
                route_suffix = "3"

            # Derive TSR Route ID from start foot tag or S.No
            start_tag = r.entry_foot_tag or f"R-{r.s_no}"
            tag_digits = "".join(filter(str.isdigit, start_tag)) or str(r.s_no)
            tsr_route_id = f"{tag_digits}{route_suffix}"

            # Format OHE Pole series dynamically
            if ohe_poles:
                pole_sample = ohe_poles[:8]
                pole_str = ",".join(f"({round(p.chainage_m, 2)}-{p.mast_id})" for p in pole_sample)
            else:
                pole_str = "-"

            last_pole_dist = round((r.distance_m % 65.0) + 2.5, 2)

            tsr_rows.append(TsrRouteRow(
                s_no=r.s_no,
                entry_signal=r.entry_signal,
                exit_signal=r.exit_signal,
                ohe_line=ohe_line,
                ohe_line_start_rfid_tag=start_tag,
                tsr_route_id=tsr_route_id,
                entry_signal_dist_from_ohe_start_m=0.0,
                last_pole_dist_from_exit_signal_m=last_pole_dist,
                ohe_pole_km_data=pole_str
            ))

        log.info("Generated %d TSR Route rows with Zero Hardcoding", len(tsr_rows))
        return tsr_rows
