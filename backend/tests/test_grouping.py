"""Unit tests for GeometryGroupingEngine."""
import pytest
from app.services.cad.grouping_engine import (
    GeometryGroupingEngine,
    GeometricPrimitive,
    GroupedComponent,
)


def test_group_axle_counters():
    engine = GeometryGroupingEngine(proximity_threshold=20.0)
    
    # Create two circles side-by-side representing wheel sensor heads
    c1 = GeometricPrimitive(
        handle="C1",
        dxftype="CIRCLE",
        layer="SIGNALS",
        color="#00FFFF",
        bbox=[100.0, 50.0, 106.0, 56.0],
        center=[103.0, 53.0],
        radius=3.0,
    )
    c2 = GeometricPrimitive(
        handle="C2",
        dxftype="CIRCLE",
        layer="SIGNALS",
        color="#00FFFF",
        bbox=[108.0, 50.0, 114.0, 56.0],
        center=[111.0, 53.0],
        radius=3.0,
    )
    # Nearby DP text
    t_dp = GeometricPrimitive(
        handle="T1",
        dxftype="TEXT",
        layer="SIGNALS",
        color="#FFFFFF",
        bbox=[104.0, 60.0, 110.0, 65.0],
        center=[107.0, 62.5],
        text="DP7B",
    )
    
    groups = engine.group_axle_counters([c1, c2], [t_dp])
    assert len(groups) == 1
    grp = groups[0]
    assert grp.category_key == "axle_counters"
    assert grp.category_id == 4
    assert "DP7B" in grp.name
    assert "C1" in grp.member_handles
    assert "C2" in grp.member_handles
    assert "T1" in grp.member_handles
    assert grp.confidence >= 0.85


def test_group_rfid_tags():
    engine = GeometryGroupingEngine(proximity_threshold=25.0)
    
    # Triangle / Chevron chevron line
    p_chev = GeometricPrimitive(
        handle="P1",
        dxftype="LWPOLYLINE",
        layer="RFID",
        color="#FF00FF",
        bbox=[500.0, 100.0, 510.0, 105.0],
        center=[505.0, 102.5],
    )
    # Tag number text
    t_rfid = GeometricPrimitive(
        handle="T2",
        dxftype="TEXT",
        layer="RFID",
        color="#FFFFFF",
        bbox=[502.0, 110.0, 515.0, 115.0],
        center=[508.5, 112.5],
        text="R-166",
    )
    
    groups = engine.group_rfid_tags([p_chev], [t_rfid])
    assert len(groups) == 1
    grp = groups[0]
    assert grp.category_key == "rfid_tags"
    assert grp.category_id == 3
    assert "R-166" in grp.name
    assert grp.tags.get("RFID_TAG_NO.") == "R-166"
    assert "P1" in grp.member_handles
    assert "T2" in grp.member_handles

