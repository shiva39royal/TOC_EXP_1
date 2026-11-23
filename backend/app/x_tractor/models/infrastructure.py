"""Pydantic and dataclass models for railway infrastructure entities in X-Tractor.
Zero hardcoding: all entity properties default to empty or zero and are populated dynamically from CAD layouts.
"""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class BaseInfrastructureItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = ""
    track_name: str = ""
    chainage_m: float = 0.0
    handle: str = ""


class StationMeta(BaseModel):
    model_config = ConfigDict(extra="allow")
    station_name: str = ""
    station_id: str = ""
    station_code: str = ""
    section: str = ""
    division: str = ""
    chainage_km: float = 0.0
    sip_no: str = ""
    toc_no: str = ""
    rfid_layout_no: str = ""
    firm_name: str = ""
    version: str = ""


class SignalItem(BaseInfrastructureItem):
    name: str = ""
    signal_type: str = ""  # Populated dynamically: Distant Signal, Inner Distant, Calling-on Signal, Home Signal, Starter, Adv Starter
    is_entry: bool = False
    is_exit: bool = False
    is_lss: bool = False  # Last Stop Signal
    x: float = 0.0
    y: float = 0.0
    direction: str = ""  # "Nominal" (DN) or "Reverse" (UP)
    aspects: list[str] = Field(default_factory=list)
    foot_tag: str = ""


class PointItem(BaseInfrastructureItem):
    name: str = ""  # e.g., P11, P12, P13
    x: float = 0.0
    y: float = 0.0
    normal_direction: str = ""
    reverse_direction: str = ""
    point_type: str = ""  # Turnout, Crossover


class TinItem(BaseInfrastructureItem):
    name: str = ""  # e.g., N-62, N-64, N-90
    min_x: float = 0.0
    max_x: float = 0.0
    y: float = 0.0
    is_block_section: bool = False


class RfidTagItem(BaseInfrastructureItem):
    tag_no: str = ""  # e.g., R-514, R-666, R-452
    x: float = 0.0
    y: float = 0.0
    tag_type: str = ""  # N, S, T, G, A, L, F, Border
    is_foot_tag: bool = False
    is_border_tag: bool = False
    is_fouling_mark: bool = False
    associated_signal: str = ""
    direction: str = ""


class LCGateItem(BaseInfrastructureItem):
    name: str = ""
    lc_no: str = ""  # e.g., "19"
    class_type: str = ""  # Special, A, B1, B2, B, C, D
    manning_type: str = ""  # Manned, Unmanned
    x: float = 0.0
    y: float = 0.0
    whistling_enabled: str = ""


class GradientSegment(BaseModel):
    model_config = ConfigDict(extra="allow")
    start_m: float = 0.0
    end_m: float = 0.0
    length_m: float = 0.0
    grad_type: str = ""  # "R", "F", "LEVEL"
    ratio: float = 0.0  # e.g. 150 for 1 in 150, 0 for level
    raw_text: str = ""


class OhePoleItem(BaseInfrastructureItem):
    mast_id: str = ""  # e.g., "122/34"
    x: float = 0.0
    y: float = 0.0
    distance_from_prev_m: float = 0.0


class TrackConditionItem(BaseInfrastructureItem):
    cond_type: str = ""  # "Fouling Mark", "Dead Stop", "Kavach Territory Exit"
    x: float = 0.0
    y: float = 0.0
    start_distance_m: float = 0.0
    length_m: float = 0.0
    description: str = ""
