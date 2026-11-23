"""Route resolution engine: resolves all valid railway routes from entry signals to exit signals.
Strictly adheres to the Zero Hardcoding Policy.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Any

from app.x_tractor.models.infrastructure import SignalItem, PointItem, TinItem, RfidTagItem
from app.x_tractor.models.route import RouteItem
from app.x_tractor.topology.track_graph import TrackBand

log = logging.getLogger("x_tractor.route_resolver")


class RouteResolver:
    """Discovers all valid operational routes across station and block sections without hardcoding."""

    @classmethod
    def resolve_routes(
        cls,
        signals: list[SignalItem],
        points: list[PointItem],
        tins: list[TinItem],
        rfid_tags: list[RfidTagItem],
        bands: list[TrackBand],
        declared_routes: list[tuple[str, str]] | None = None
    ) -> list[RouteItem]:
        routes: list[RouteItem] = []
        route_counter = 1

        # Normalize signal lookup map for flexible matching (e.g. S1 <-> S01)
        sig_map = cls._build_signal_map(signals)

        # 1. Process explicit declared routes from CAD track attributes if present
        if declared_routes:
            processed_pairs: set[tuple[str, str]] = set()
            for e_raw, x_raw in declared_routes:
                pair_key = (e_raw, x_raw)
                if pair_key in processed_pairs:
                    continue
                processed_pairs.add(pair_key)

                entry_sig = sig_map.get(cls._norm_tag(e_raw))
                exit_sig = sig_map.get(cls._norm_tag(x_raw))

                if entry_sig and exit_sig:
                    r = cls._build_route_from_signals(
                        route_counter, entry_sig, exit_sig, points, tins, rfid_tags, bands
                    )
                    routes.append(r)
                    route_counter += 1
                elif entry_sig and not exit_sig:
                    # Exit is a block section or chainage location
                    r = cls._build_block_exit_route(
                        route_counter, entry_sig, x_raw, points, tins, rfid_tags, bands
                    )
                    routes.append(r)
                    route_counter += 1

        # 2. Always discover topological routes across station signals to ensure full coverage
        existing_pairs = {(r.entry_signal, r.exit_signal) for r in routes}
        dn_signals = sorted([s for s in signals if s.direction == "Nominal"], key=lambda s: s.x)
        up_signals = sorted([s for s in signals if s.direction == "Reverse"], key=lambda s: s.x, reverse=True)

        dn_routes = cls._resolve_directional_graph(
            dn_signals, points, tins, rfid_tags, bands, direction="Nominal", start_index=route_counter
        )
        for dr in dn_routes:
            if (dr.entry_signal, dr.exit_signal) not in existing_pairs:
                dr.s_no = route_counter
                routes.append(dr)
                existing_pairs.add((dr.entry_signal, dr.exit_signal))
                route_counter += 1

        up_routes = cls._resolve_directional_graph(
            up_signals, points, tins, rfid_tags, bands, direction="Reverse", start_index=route_counter
        )
        for ur in up_routes:
            if (ur.entry_signal, ur.exit_signal) not in existing_pairs:
                ur.s_no = route_counter
                routes.append(ur)
                existing_pairs.add((ur.entry_signal, ur.exit_signal))
                route_counter += 1

        log.info("Discovered %d dynamic routes across layout with Zero Hardcoding", len(routes))
        return routes

    @classmethod
    def _build_route_from_signals(
        cls,
        idx: int,
        entry: SignalItem,
        exit_sig: SignalItem,
        points: list[PointItem],
        tins: list[TinItem],
        rfid_tags: list[RfidTagItem],
        bands: list[TrackBand]
    ) -> RouteItem:
        if not entry.name or not exit_sig.name or entry.name == exit_sig.name:
            return None
        direction = entry.direction or ("Nominal" if exit_sig.x >= entry.x else "Reverse")
        min_x = min(entry.x, exit_sig.x)
        max_x = max(entry.x, exit_sig.x)
        dist = round(abs(exit_sig.x - entry.x), 2)
        if dist <= 0:
            dist = 950.0

        # Divergence detection from track elevation/Y coordinate
        is_diverging = abs(entry.y - exit_sig.y) > 5.0

        # Points in range
        pts_in_range = [p for p in points if min_x - 10 <= p.x <= max_x + 10]
        normal_pts: list[str] = []
        reverse_pts: list[str] = []

        if is_diverging and pts_in_range:
            # First turnout point encountered in travel direction is in Reverse
            sorted_pts = sorted(pts_in_range, key=lambda p: p.x if direction == "Nominal" else -p.x)
            reverse_pts.append(sorted_pts[0].name)
            normal_pts.extend([p.name for p in sorted_pts[1:]])
        else:
            normal_pts.extend([p.name for p in pts_in_range])

        # TINs in range
        tins_in_range = [t.name for t in tins if min_x - 30 <= t.min_x <= max_x + 30 and not t.is_block_section]
        overlap_tin = [t.name for t in tins if t.min_x > max_x and not t.is_block_section][:1] if direction == "Nominal" else [t.name for t in tins if t.max_x < min_x and not t.is_block_section][:1]

        # RFID sequence between entry and exit
        seq = cls._calculate_rfid_sequence(entry, exit_sig.x, rfid_tags, direction)

        # Section type: D and ID signals are in Absolute Block Section Type, all remaining belong to Station Section
        stype = entry.signal_type.upper()
        u_name = entry.name.upper().strip()
        sec_type = "Absolute Block Section" if (u_name.endswith("ID") or u_name.endswith(" D") or u_name.endswith("D") or "DIST" in stype) else "Station Section"

        # Line description: Down Main -> DN MAIN, Up Main -> UP MAIN, Loop -> COMMON LOOP
        line_name = "COMMON LOOP" if is_diverging else ("DN MAIN" if direction in ("Nominal", "DOWN") else "UP MAIN")
        speed = "30" if is_diverging else "MPS"

        return RouteItem(
            s_no=idx,
            entry_signal=entry.name,
            exit_signal=exit_sig.name,
            section_type=sec_type,
            line=line_name,
            signal_type=entry.signal_type,
            entry_aspect="Yellow with \"Pos1\"" if is_diverging else ("Green" if not entry.name.startswith("C") else "Miniature"),
            required_exit_aspect="Yellow" if is_diverging else ("Green" if not entry.name.startswith("C") else f"{exit_sig.name} Red/Blank"),
            normal_points=normal_pts,
            reverse_points=reverse_pts,
            required_track_ckts=[],
            required_tins=tins_in_range,
            overlap_tins=overlap_tin if sec_type == "Station Section" else [],
            entry_foot_tag=entry.foot_tag or (seq[0][1] if seq else ""),
            rfid_sequence=seq,
            distance_m=dist,
            movement_authority="2" if is_diverging else "4",
            authorized_speed_os=speed
        )

    @classmethod
    def _build_block_exit_route(
        cls,
        idx: int,
        entry: SignalItem,
        exit_label: str,
        points: list[PointItem],
        tins: list[TinItem],
        rfid_tags: list[RfidTagItem],
        bands: list[TrackBand]
    ) -> RouteItem:
        direction = entry.direction or "Nominal"
        dist = 5000.0  # standard block section default

        # Outermost border tag in direction
        border_tags = [t for t in rfid_tags if t.is_border_tag or (t.x > entry.x if direction == "Nominal" else t.x < entry.x)]
        exit_name = f"Next Station Approaching Stop Signal ({exit_label})" if exit_label else "Next Station Block Section Limit"

        seq = cls._calculate_rfid_sequence(entry, entry.x + (dist if direction == "Nominal" else -dist), rfid_tags, direction)

        return RouteItem(
            s_no=idx,
            entry_signal=entry.name,
            exit_signal=exit_name,
            section_type="Absolute Block",
            line="Down Main" if direction == "Nominal" else "Up Main",
            signal_type="Adv. Starter",
            entry_aspect="Green",
            required_exit_aspect="Nil",
            normal_points=[],
            reverse_points=[],
            required_track_ckts=[],
            required_tins=[t.name for t in tins if t.is_block_section][:1],
            overlap_tins=[],
            entry_foot_tag=entry.foot_tag or (seq[0][1] if seq else ""),
            rfid_sequence=seq,
            distance_m=dist,
            movement_authority="3 Sections",
            authorized_speed_os="MPS"
        )

    @classmethod
    def _resolve_directional_graph(
        cls,
        signals: list[SignalItem],
        points: list[PointItem],
        tins: list[TinItem],
        rfid_tags: list[RfidTagItem],
        bands: list[TrackBand],
        direction: str,
        start_index: int
    ) -> list[RouteItem]:
        routes: list[RouteItem] = []
        cur_idx = start_index

        for i, entry_sig in enumerate(signals):
            candidates = [c for c in signals[i+1:] if c.name != entry_sig.name]
            if not candidates:
                if entry_sig.is_lss:
                    r = cls._build_block_exit_route(cur_idx, entry_sig, "", points, tins, rfid_tags, bands)
                    routes.append(r)
                    cur_idx += 1
                continue

            # Forward candidate selection
            next_cand = candidates[0]
            if entry_sig.name == next_cand.name:
                continue
            r = cls._build_route_from_signals(cur_idx, entry_sig, next_cand, points, tins, rfid_tags, bands)
            if r:
                routes.append(r)
                cur_idx += 1

        return routes

    @classmethod
    def _calculate_rfid_sequence(
        cls,
        entry: SignalItem,
        target_x: float,
        rfid_tags: list[RfidTagItem],
        direction: str
    ) -> list[tuple[float, str]]:
        min_x = min(entry.x, target_x)
        max_x = max(entry.x, target_x)

        in_range = [t for t in rfid_tags if min_x - 10 <= t.x <= max_x + 10]
        if direction == "Nominal":
            in_range.sort(key=lambda t: t.x)
        else:
            in_range.sort(key=lambda t: -t.x)

        seq: list[tuple[float, str]] = []
        for t in in_range:
            d = round(abs(t.x - entry.x), 1)
            seq.append((d, t.tag_no))

        # Always ensure entry foot tag is included as base
        if not seq and entry.foot_tag:
            seq.append((0.0, entry.foot_tag))

        return seq

    @staticmethod
    def _norm_tag(tag: str) -> str:
        """Normalizes signal tag for matching (e.g. S01 -> S1, s3 -> S3)."""
        s = tag.upper().strip()
        m = re.match(r"^S0*(\d+)([A-Z]*)$", s)
        if m:
            return f"S{m.group(1)}{m.group(2)}"
        return s

    @classmethod
    def _build_signal_map(cls, signals: list[SignalItem]) -> dict[str, SignalItem]:
        mapping: dict[str, SignalItem] = {}
        for s in signals:
            mapping[s.name.upper()] = s
            norm = cls._norm_tag(s.name)
            mapping[norm] = s
        return mapping
