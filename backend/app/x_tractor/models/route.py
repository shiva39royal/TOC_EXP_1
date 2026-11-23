"""Route representation model for X-Tractor signaling topology."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class RouteItem(BaseModel):
    s_no: int
    entry_signal: str
    exit_signal: str
    section_type: str = "Station Section"  # Station Section, Absolute Block, Automatic Section
    line: str = "Down Main"
    signal_type: str = "Main Home with Junction Route"
    entry_aspect: str = "Green"
    required_exit_aspect: str = "Green"
    normal_points: list[str] = Field(default_factory=list)
    reverse_points: list[str] = Field(default_factory=list)
    required_track_ckts: list[str] = Field(default_factory=list)
    required_tins: list[str] = Field(default_factory=list)
    overlap_tins: list[str] = Field(default_factory=list)
    entry_foot_tag: str = ""
    rfid_sequence: list[tuple[float, str]] = Field(default_factory=list)  # [(0, "R-514"), (199, "R-516"), ...]
    distance_m: float = 0.0
    movement_authority: str = "4"  # "4", "3", "2", "1", or "3 Sections"
    authorized_speed_os: str = "MPS"  # MPS, 30, 15
    path_points: list[tuple[float, float]] = Field(default_factory=list)
