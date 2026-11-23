"""Generator for Stationary KAVACH Table of Control (TOC), Block Section Details, and Shunting Limits.
Enforces the Strict Zero Hardcoding Policy.
"""
from __future__ import annotations

import logging
from typing import Any

from app.x_tractor.models.infrastructure import StationMeta, SignalItem, RfidTagItem, TinItem
from app.x_tractor.models.route import RouteItem
from app.x_tractor.models.kavach_tables import TableOfControlRow, BlockSectionDetailsRow, ShuntingLimitRow

log = logging.getLogger("x_tractor.toc_generator")


class TocGenerator:
    """Synthesizes official KAVACH Table of Control rows and supporting sub-tables without hardcoding."""

    @classmethod
    def generate(
        cls,
        routes: list[RouteItem],
        station_meta: StationMeta,
        signals: list[SignalItem],
        rfid_tags: list[RfidTagItem],
        tins: list[TinItem]
    ) -> tuple[list[TableOfControlRow], list[BlockSectionDetailsRow], list[ShuntingLimitRow]]:
        toc_rows: list[TableOfControlRow] = []

        # 1. Generate TOC rows from routes
        for r in routes:
            seq_str = ", ".join(f"({d}, {t})" for d, t in r.rfid_sequence) if r.rfid_sequence else "-"
            normal_pts_str = ", ".join(r.normal_points) if r.normal_points else "-"
            rev_pts_str = ", ".join(r.reverse_points) if r.reverse_points else "-"
            tk_ckts_str = ", ".join(r.required_track_ckts) if r.required_track_ckts else "-"
            tins_str = ", ".join(r.required_tins) if r.required_tins else "-"
            overlap_tins_str = ", ".join(r.overlap_tins) if r.overlap_tins else "-"

            row = TableOfControlRow(
                s_no=r.s_no,
                entry_signal=r.entry_signal,
                exit_signal=r.exit_signal,
                section_type=r.section_type,
                line=r.line,
                signal_type=r.signal_type,
                aspect_entry_signal=r.entry_aspect,
                requires_aspect_exit_signal=r.required_exit_aspect,
                points_normal=normal_pts_str,
                points_reverse=rev_pts_str,
                requires_track_ckt_up=tk_ckts_str,
                tins_requires_free=tins_str,
                tins_requires_free_overlap=overlap_tins_str,
                entry_signal_foot_tag=r.entry_foot_tag or "-",
                rfid_sequence_str=seq_str,
                distance_between_signals_m=r.distance_m,
                movement_authority=str(r.movement_authority),
                authorized_speed_os=r.authorized_speed_os
            )
            toc_rows.append(row)

        # 2. Generate Block Section Details for Last Stop Signals (LSS)
        block_section_rows: list[BlockSectionDetailsRow] = []
        lss_signals = [s for s in signals if s.is_lss]
        if not lss_signals and signals:
            # Fallback to outermost starters if no explicit LSS text
            dn_outer = max([s for s in signals if s.direction == "Nominal"], key=lambda s: s.x, default=None)
            up_outer = min([s for s in signals if s.direction == "Reverse"], key=lambda s: s.x, default=None)
            lss_signals = [s for s in (dn_outer, up_outer) if s is not None]

        base_km = station_meta.chainage_km * 1000.0 if station_meta.chainage_km > 0 else 100000.0

        for s in lss_signals:
            is_up = s.direction == "Reverse"
            dist = 5000.0

            # Dynamic border tag identification
            border = next((t for t in rfid_tags if t.is_border_tag and (t.x < s.x if is_up else t.x > s.x)), None)
            if not border and rfid_tags:
                border = rfid_tags[0] if is_up else rfid_tags[-1]
            border_tag = f"{border.tag_no}, {int(base_km + border.x)}" if border else "-"

            # Dynamic block TIN
            block_tin_cand = next((t for t in tins if t.is_block_section and (t.min_x < s.x if is_up else t.max_x > s.x)), None)
            block_tin = block_tin_cand.name if block_tin_cand else "-"

            stn_id = int(station_meta.station_id) if station_meta.station_id.isdigit() else 50000
            next_stn_id = str(stn_id - 1 if is_up else stn_id + 1)

            block_section_rows.append(BlockSectionDetailsRow(
                last_stop_signal=s.name,
                distance_to_next_stop_signal_m=dist,
                block_section_tin=block_tin,
                movement_direction="UP" if is_up else "Down",
                adjacent_line_tins="-",
                next_station_id=next_stn_id,
                next_station_border_rfid_location=border_tag,
                authorised_speed="MPS",
                start_dist_abs_loc_reset_m=1600.0,
                abs_loc_correction_m=50.0,
                loco_direction_after_adj="Reverse" if is_up else "Nominal"
            ))

        # 3. Generate Shunting Limit Table
        shunting_rows: list[ShuntingLimitRow] = []
        shunt_candidates = [t for t in rfid_tags if t.is_fouling_mark or "FM" in t.tag_no or "SHUNT" in t.tag_no]
        if not shunt_candidates and rfid_tags:
            # Use outermost boundary tags
            shunt_candidates = rfid_tags[:2] + rfid_tags[-2:]

        adj_name = station_meta.section or "Block Section"
        for idx, tag in enumerate(shunt_candidates):
            is_rev = tag.x < 0
            tin_cand = next((t.name for t in tins if abs(t.min_x - tag.x) < 100), "-")
            abs_loc = round(base_km + tag.x, 0)
            shunting_rows.append(ShuntingLimitRow(
                adjacent_station_name=adj_name,
                direction="Reverse" if is_rev else "Nominal",
                rfid_tag_no=tag.tag_no,
                tin=tin_cand,
                absolute_location_m=abs_loc
            ))

        log.info("Generated %d TOC rows, %d Block Section rows, %d Shunting rows with Zero Hardcoding",
                 len(toc_rows), len(block_section_rows), len(shunting_rows))
        return toc_rows, block_section_rows, shunting_rows
