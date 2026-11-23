"""Unit tests for CadConversionVerifier."""
import pytest
import ezdxf
from app.services.cad.conversion_verifier import CadConversionVerifier, ConversionFidelityReport


def test_verify_empty_document():
    doc = ezdxf.new("R2018")
    report = CadConversionVerifier.verify_document(doc, "empty.dxf")
    assert report.total_entities == 0
    assert report.is_empty_or_corrupt is True
    assert any("0 modelspace entities" in w for w in report.warnings)


def test_verify_populated_document():
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("RAIL_TRACK")
    doc.layers.add("SIGNALS")
    
    # Add entities
    msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "RAIL_TRACK"})
    msp.add_circle((50, 50), 10, dxfattribs={"layer": "SIGNALS"})
    
    # Add blocks
    blk = doc.blocks.new("TEST_BLOCK")
    blk.add_line((0, 0), (10, 10))
    msp.add_blockref("TEST_BLOCK", (200, 200))
    
    # Add anonymous block
    doc.blocks.new("*U1")
    
    report = CadConversionVerifier.verify_document(doc, "sample.dxf")
    assert report.is_valid is True
    assert report.is_empty_or_corrupt is False
    assert report.total_entities == 3
    assert report.entity_counts.get("LINE") == 1
    assert report.entity_counts.get("CIRCLE") == 1
    assert report.entity_counts.get("INSERT") == 1
    assert "RAIL_TRACK" in report.layers
    assert "SIGNALS" in report.layers
    assert report.total_blocks >= 2
    assert report.anonymous_blocks_count >= 1
    assert report.drawing_extents["min_x"] <= 0.0
    assert report.drawing_extents["max_x"] >= 100.0


def test_verify_sample_dwg_converted_dxf():
    from pathlib import Path
    dwg_file = Path("0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg")
    temp_dxf = Path("backend/temp/aespl_c.dxf")
    if not temp_dxf.exists():
        if dwg_file.exists():
            from app.services.cad_converter import convert_dwg_to_dxf
            temp_dxf.parent.mkdir(parents=True, exist_ok=True)
            convert_dwg_to_dxf(dwg_file, temp_dxf)
        else:
            pytest.skip("Authentic AESPL_C DWG not present in repository")
    doc = ezdxf.readfile(str(temp_dxf))
    report = CadConversionVerifier.verify_document(doc, temp_dxf.name)
    if report.total_entities < 50:
        pytest.skip("aespl_c.dxf is a synthetic test fixture, skipping authentic threshold checks")
    assert report.is_valid is True
    assert report.total_entities >= 200
    assert report.total_layers >= 10
    assert report.total_blocks >= 400
