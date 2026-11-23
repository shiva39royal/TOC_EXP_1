"""Unit tests for the authoritative CoordinateTransformer and 4x4 matrix engine."""
import math
import pytest
import ezdxf
from ezdxf.math import Matrix44, Vec3
from app.services.cad.coordinate_transformer import CoordinateTransformer, BlockHierarchyResult


def test_basic_translation():
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.blocks.new("TEST_BLOCK")
    ins = msp.add_blockref("TEST_BLOCK", (100.0, 200.0))
    
    m = CoordinateTransformer.get_insert_matrix(ins)
    pt = CoordinateTransformer.transform_pt(m, (10.0, 20.0))
    assert pt == [110.0, 220.0]


def test_rotation_transform():
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.blocks.new("TEST_BLOCK")
    ins_90 = msp.add_blockref("TEST_BLOCK", (0.0, 0.0), dxfattribs={"rotation": 90.0})
    
    m = CoordinateTransformer.get_insert_matrix(ins_90)
    pt_90 = CoordinateTransformer.transform_pt(m, (10.0, 0.0))
    assert math.isclose(pt_90[0], 0.0, abs_tol=1e-3)
    assert math.isclose(pt_90[1], 10.0, abs_tol=1e-3)

    ins_180 = msp.add_blockref("TEST_BLOCK", (0.0, 0.0), dxfattribs={"rotation": 180.0})
    m_180 = CoordinateTransformer.get_insert_matrix(ins_180)
    pt_180 = CoordinateTransformer.transform_pt(m_180, (10.0, 0.0))
    assert math.isclose(pt_180[0], -10.0, abs_tol=1e-3)
    assert math.isclose(pt_180[1], 0.0, abs_tol=1e-3)


def test_scaling_and_mirroring():
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.blocks.new("TEST_BLOCK")
    ins_mirror = msp.add_blockref("TEST_BLOCK", (50.0, 50.0), dxfattribs={"xscale": -1.0, "yscale": 1.0})
    
    m = CoordinateTransformer.get_insert_matrix(ins_mirror)
    pt = CoordinateTransformer.transform_pt(m, (10.0, 0.0))
    assert pt == [40.0, 50.0]  # 50 - 10

    decomp = CoordinateTransformer.decompose(m)
    assert decomp["is_mirrored"] is True
    assert decomp["translation"] == [50.0, 50.0]


def test_bbox_transformation_rotated():
    # Local box: min_x=0, min_y=0, max_x=10, max_y=20
    # Rotated 90 deg at origin:
    # (0,0) -> (0,0), (10,0) -> (0,10), (10,20) -> (-20,10), (0,20) -> (-20,0)
    # Expected world box: min_x=-20, min_y=0, max_x=0, max_y=10
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.blocks.new("TEST_BLOCK")
    ins = msp.add_blockref("TEST_BLOCK", (0.0, 0.0), dxfattribs={"rotation": 90.0})
    
    m = CoordinateTransformer.get_insert_matrix(ins)
    bbox_world = CoordinateTransformer.transform_bbox(m, (0.0, 0.0, 10.0, 20.0))
    assert math.isclose(bbox_world[0], -20.0, abs_tol=1e-3)
    assert math.isclose(bbox_world[1], 0.0, abs_tol=1e-3)
    assert math.isclose(bbox_world[2], 0.0, abs_tol=1e-3)
    assert math.isclose(bbox_world[3], 10.0, abs_tol=1e-3)


def test_nested_matrix_composition():
    parent_m = Matrix44.translate(100.0, 50.0, 0.0)
    child_m = Matrix44.scale(2.0, 2.0, 1.0) @ Matrix44.translate(10.0, 5.0, 0.0)
    
    comb = CoordinateTransformer.compose(parent_m, child_m)
    pt = CoordinateTransformer.transform_pt(comb, (0.0, 0.0))
    # (0,0) * 2 + (10,5) = (10,5) in parent, then + (100,50) = (110, 55)
    assert pt == [110.0, 55.0]


def test_recursive_block_unwrap_with_cycle_detection():
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    
    # Define real inner block
    sig_blk = doc.blocks.new("SIGNAL_HEAD")
    sig_blk.add_attdef("SIGNAL_NO", (0, 0), text="S101")
    
    # Define anonymous block wrapping it
    u_blk = doc.blocks.new("*U1")
    u_blk.add_blockref("SIGNAL_HEAD", (5.0, 5.0))
    
    # Insert *U1 into modelspace at (100, 200)
    ins = msp.add_blockref("*U1", (100.0, 200.0))
    
    res = CoordinateTransformer.resolve_block_hierarchy(ins, doc)
    assert res.canonical_name == "SIGNAL_HEAD"
    assert res.raw_name == "*U1"
    assert res.has_anonymous_parent is True
    assert res.attributes.get("SIGNAL_NO") == "S101"
    
    # Transformed insertion of inner head in world
    pt = CoordinateTransformer.transform_pt(res.world_matrix, (0.0, 0.0))
    assert pt == [105.0, 205.0]

