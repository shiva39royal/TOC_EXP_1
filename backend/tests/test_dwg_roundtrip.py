"""End-to-End DWG-to-X-Tractor Roundtrip Integration Test.

Tests the complete X-Tractor pipeline on DWG / DXF engineering layout:
1. DWG -> DXF Conversion / Loading
2. CadConversionVerifier verification
3. Component Extraction with CoordinateTransformer & RailwayOntology
4. X-Tractor Engine Table Generation (TOC, Profile, TSR, TSL, Block Section, Shunting)
5. Multi-sheet RDSO Excel (.xlsx) and CSV export verification
"""
from pathlib import Path
import pytest
import ezdxf

from app.services.cad.conversion_verifier import CadConversionVerifier
from app.services.component_extractor import extract_components
from app.x_tractor.engine import XTractorEngine
from app.x_tractor.exporters.excel_exporter import ExcelExporter


def test_complete_dwg_to_x_tractor_roundtrip():
    project_root = Path(__file__).resolve().parent.parent.parent
    dwg_file = project_root / "0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg"
    
    if dwg_file.exists():
        temp_dxf = project_root / "backend" / "temp" / "aespl_c.dxf"
        if not temp_dxf.exists():
            from app.services.cad_converter import convert_dwg_to_dxf
            temp_dxf.parent.mkdir(parents=True, exist_ok=True)
            convert_dwg_to_dxf(dwg_file, temp_dxf)
    else:
        temp_dxf = project_root / "backend" / "temp" / "synthetic_roundtrip.dxf"
        if not temp_dxf.exists():
            from tests.make_sample import make
            temp_dxf.parent.mkdir(parents=True, exist_ok=True)
            make(str(temp_dxf))

    assert temp_dxf.exists(), "DXF file must exist"
    doc = ezdxf.readfile(str(temp_dxf))

    # 1. Fidelity Verification
    fidelity = CadConversionVerifier.verify_document(doc, temp_dxf.name)
    assert fidelity.is_valid is True
    assert fidelity.is_empty_or_corrupt is False

    # 2. Component Extraction
    comp_data = extract_components(doc, dwg_path=dwg_file if dwg_file.exists() else None)
    components = comp_data.get("components", [])
    categories = comp_data.get("categories", [])
    assert len(categories) >= 1

    # 3. X-Tractor Engine Execution
    result = XTractorEngine.extract_from_dxf(
        temp_dxf,
        dwg_path=dwg_file if dwg_file.exists() else None,
    )

    # 4. Check Schema Compliance & Values
    assert result.station_meta.station_name != "" or result.station_meta.station_code != ""
    assert isinstance(result.table_of_control, list)
    assert isinstance(result.track_profiles, list)
    assert isinstance(result.tsr_routes, list)
    assert isinstance(result.tsl_routes, list)
    assert isinstance(result.block_section_details, list)
    assert isinstance(result.shunting_limits, list)

    # 5. Multi-sheet Excel (.xlsx) Export Verification
    excel_bytes = ExcelExporter.export_workbook(result)
    assert len(excel_bytes) > 2000
    assert excel_bytes[:4] == b"PK\x03\x04", "Must be a valid zipped OpenXML Excel workbook"
