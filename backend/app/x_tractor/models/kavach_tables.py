"""Official RDSO KAVACH Table Schemas (Annexure-I Amdt-6)."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field
from app.x_tractor.models.infrastructure import StationMeta


class TableOfControlRow(BaseModel):
    s_no: int
    entry_signal: str
    exit_signal: str
    section_type: str
    line: str
    signal_type: str
    aspect_entry_signal: str
    requires_aspect_exit_signal: str
    points_normal: str = "-"
    points_reverse: str = "-"
    requires_track_ckt_up: str = "-"
    tins_requires_free: str = "-"
    tins_requires_free_overlap: str = "-"
    entry_signal_foot_tag: str = "-"
    rfid_sequence_str: str = "-"
    distance_between_signals_m: float = 0.0
    movement_authority: str = "1"
    authorized_speed_os: str = "MPS"


class BlockSectionDetailsRow(BaseModel):
    last_stop_signal: str
    distance_to_next_stop_signal_m: float
    block_section_tin: str
    movement_direction: str  # "UP" or "Down"
    adjacent_line_tins: str
    next_station_id: str
    next_station_border_rfid_location: str
    authorised_speed: str = "MPS"
    start_dist_abs_loc_reset_m: float = 0.0
    abs_loc_correction_m: float = 0.0
    loco_direction_after_adj: str = "Nominal"


class ShuntingLimitRow(BaseModel):
    adjacent_station_name: str
    direction: str  # "Nominal" or "Reverse"
    rfid_tag_no: str
    tin: str
    absolute_location_m: float


class TrackProfileRow(BaseModel):
    s_no: int
    entry_signal: str
    exit_signal: str
    line: str
    turnout_speed_kmph: str = "-"
    turnout_start_dist_m: str = "-"
    turnout_length_m: str = "-"
    psr_str: str = "-"  # e.g., "(U,110,1023)"
    engineering_gradients_str: str = "-"  # e.g., "(R 1 in 150, 297)"
    average_gradient_value: str = "-"  # e.g., "R 1 in 150", "LEVEL"
    gradient_length_m: str = "-"
    lc_distance_m: str = "-"
    lc_id: str = "-"
    lc_manning_type: str = "-"
    lc_class: str = "-"
    lc_auto_whistling: str = "-"
    track_condition_type: str = "-"
    track_condition_start_m: str = "-"
    track_condition_length_m: str = "-"


class TsrRouteRow(BaseModel):
    s_no: int
    entry_signal: str
    exit_signal: str
    ohe_line: str
    ohe_line_start_rfid_tag: str
    tsr_route_id: str
    entry_signal_dist_from_ohe_start_m: float = 0.0
    last_pole_dist_from_exit_signal_m: float = 0.0
    ohe_pole_km_data: str = "-"


class TslWorkingRow(BaseModel):
    tsl_entry_signal: str
    tsl_exit_signal: str
    signal_type: str
    aspect_entry_signal: str = "Red/Blank"
    requires_aspect_exit_signal: str = "Red"
    required_route_command: str = "-"
    points_normal: str = "-"
    points_reverse: str = "-"
    requires_track_ckt_up: str = "-"
    tins_requires_free: str = "-"
    entry_signal_foot_tag: str = "-"
    rfid_sequence_str: str = "-"
    distance_between_signals_m: float = 0.0
    movement_authority: str = "1"
    authorized_speed_os: str = "25/booked speed"


class FullKavachExport(BaseModel):
    station_meta: StationMeta
    table_of_control: list[TableOfControlRow] = Field(default_factory=list)
    block_section_details: list[BlockSectionDetailsRow] = Field(default_factory=list)
    shunting_limits: list[ShuntingLimitRow] = Field(default_factory=list)
    track_profiles: list[TrackProfileRow] = Field(default_factory=list)
    tsr_routes: list[TsrRouteRow] = Field(default_factory=list)
    tsl_routes: list[TslWorkingRow] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
