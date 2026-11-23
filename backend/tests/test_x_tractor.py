"""Unit & Integration tests for X-Tractor RDSO KAVACH extraction engine."""
import io
import openpyxl
import pytest
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

from app.x_tractor.engine import XTractorEngine
from app.x_tractor.exporters.excel_exporter import ExcelExporter
from app.x_tractor.exporters.json_csv_exporter import JsonCsvExporter
from app.x_tractor.parser.chainage_parser import ChainageParser
from app.x_tractor.models.infrastructure import GradientSegment


def _create_sample_railway_dxf(path: Path) -> None:
    """Creates a synthetic railway layout with tracks, turnouts, signals, tags, TINs, and title block."""
    doc = ezdxf.new("R2018", setup=True)
    msp = doc.modelspace()

    # 1. Title Block Text
    msp.add_text("STATION NAME: TEST JUNCTION (TJN)", dxfattribs={"insert": (100, 900), "height": 20})
    msp.add_text("Station ID: 777", dxfattribs={"insert": (100, 850), "height": 14})
    msp.add_text("Division: SECUNDERABAD", dxfattribs={"insert": (400, 900), "height": 14})
    msp.add_text("Section: HYB-KZJ", dxfattribs={"insert": (400, 850), "height": 14})
    msp.add_text("km : 150.500", dxfattribs={"insert": (700, 850), "height": 14})

    # 2. Main Track (Down Main at Y=100) & Loop Track (Common Loop at Y=150)
    # Down Main straight rail from X=0 to X=2000
    msp.add_line((0, 100), (2000, 100), dxfattribs={"layer": "TRACK_MAIN"})
    # Common Loop rail from X=400 to X=1600
    msp.add_line((400, 150), (1600, 150), dxfattribs={"layer": "TRACK_LOOP"})
    # Turnout switch crossovers connecting Main and Loop
    msp.add_line((300, 100), (400, 150), dxfattribs={"layer": "TURNOUT"})  # Diverging to loop
    msp.add_line((1600, 150), (1700, 100), dxfattribs={"layer": "TURNOUT"})  # Converging back to main

    # 3. Points
    msp.add_text("P-11", dxfattribs={"insert": (310, 110), "height": 8})
    msp.add_text("P-13", dxfattribs={"insert": (410, 160), "height": 8})
    msp.add_text("P-18", dxfattribs={"insert": (1610, 160), "height": 8})
    msp.add_text("P-20", dxfattribs={"insert": (1690, 110), "height": 8})

    # 4. Signals
    msp.add_text("S1 D", dxfattribs={"insert": (50, 115), "height": 10})
    msp.add_text("S1 ID", dxfattribs={"insert": (150, 115), "height": 10})
    msp.add_text("S1", dxfattribs={"insert": (250, 115), "height": 10})
    msp.add_text("S3", dxfattribs={"insert": (1200, 115), "height": 10})  # Main starter
    msp.add_text("S4", dxfattribs={"insert": (1200, 165), "height": 10})  # Loop starter
    msp.add_text("S6", dxfattribs={"insert": (1800, 115), "height": 10})  # Adv starter (LSS)

    # 5. RFID Tags
    msp.add_text("R-666", dxfattribs={"insert": (50, 95), "height": 8})   # S1 D foot tag
    msp.add_text("R-670", dxfattribs={"insert": (150, 95), "height": 8})  # S1 ID foot tag
    msp.add_text("R-514", dxfattribs={"insert": (250, 95), "height": 8})  # S1 Home foot tag
    msp.add_text("R-516", dxfattribs={"insert": (450, 95), "height": 8})  # En-route tag
    msp.add_text("R-518", dxfattribs={"insert": (650, 95), "height": 8})  # En-route tag
    msp.add_text("R-520", dxfattribs={"insert": (850, 95), "height": 8})  # En-route tag
    msp.add_text("R-522", dxfattribs={"insert": (1050, 95), "height": 8}) # En-route tag
    msp.add_text("R-524", dxfattribs={"insert": (1200, 95), "height": 8}) # S3 foot tag
    msp.add_text("R-528", dxfattribs={"insert": (1800, 95), "height": 8}) # S6 foot tag
    msp.add_text("R-452", dxfattribs={"insert": (1950, 95), "height": 8}) # Border tag

    # 6. TIN notations
    msp.add_text("(N-62)", dxfattribs={"insert": (500, 105), "height": 9})
    msp.add_text("(N-64)", dxfattribs={"insert": (900, 105), "height": 9})
    msp.add_text("(N-66)", dxfattribs={"insert": (1300, 105), "height": 9})
    msp.add_text("(N-90)", dxfattribs={"insert": (1900, 105), "height": 9})

    # 7. Level Crossing Gate
    msp.add_text("'C' CLASS LC.No.19 MANNED", dxfattribs={"insert": (700, 100), "height": 10})

    # 8. OHE Masts
    msp.add_text("150/2", dxfattribs={"insert": (100, 80), "height": 7})
    msp.add_text("150/4", dxfattribs={"insert": (300, 80), "height": 7})
    msp.add_text("150/6", dxfattribs={"insert": (500, 80), "height": 7})

    doc.saveas(str(path))


def test_chainage_parser_rdso_gradient():
    segments = [
        GradientSegment(start_m=0, end_m=150, length_m=150, grad_type="R", ratio=100, raw_text="R 1 in 100"),
        GradientSegment(start_m=150, end_m=770, length_m=620, grad_type="R", ratio=260, raw_text="R 1 in 260"),
        GradientSegment(start_m=770, end_m=870, length_m=100, grad_type="LEVEL", ratio=0, raw_text="Level"),
    ]
    avg_grad, total_len = ChainageParser.calculate_rdso_average_gradient(segments)
    assert "R 1 in" in avg_grad
    assert total_len == 870


def test_xtractor_engine_end_to_end(tmp_path: Path):
    dxf_file = tmp_path / "test_station.dxf"
    _create_sample_railway_dxf(dxf_file)

    # Run X-Tractor
    export = XTractorEngine.extract_from_dxf(dxf_file)

    # 1. Verify Station Metadata
    assert export.station_meta.station_name == "TEST JUNCTION"
    assert export.station_meta.station_code == "TJN"
    assert export.station_meta.station_id == "777"
    assert export.station_meta.division == "SECUNDERABAD"
    assert export.station_meta.section == "HYB-KZJ"

    # 2. Verify Table of Control
    assert len(export.table_of_control) >= 3
    toc_first = export.table_of_control[0]
    assert toc_first.entry_signal == "S1 D"
    assert toc_first.exit_signal == "S1 ID"
    assert toc_first.section_type in ("Absolute Block", "Absolute Block Section")

    # Verify Home to Main Starter route
    home_main_route = next((r for r in export.table_of_control if r.entry_signal == "S1" and r.exit_signal == "S3"), None)
    assert home_main_route is not None
    assert "P-11" in home_main_route.points_normal or "P-13" in home_main_route.points_normal
    assert "R-514" in home_main_route.rfid_sequence_str

    # 3. Verify Track Profiles
    assert len(export.track_profiles) == len(export.table_of_control)
    prof_first = export.track_profiles[0]
    assert prof_first.entry_signal == "S1 D"
    assert prof_first.psr_str is not None

    # 4. Verify TSR Routes
    assert len(export.tsr_routes) == len(export.table_of_control)
    tsr_first = export.tsr_routes[0]
    assert tsr_first.entry_signal == "S1 D"
    assert tsr_first.ohe_line != "-"

    # 5. Verify TSL Routes
    assert len(export.tsl_routes) > 0
    assert export.tsl_routes[0].aspect_entry_signal == "Red/Blank"
    assert export.tsl_routes[0].requires_aspect_exit_signal == "Red"

    # 6. Verify Excel Export
    excel_bytes = ExcelExporter.export_workbook(export)
    assert len(excel_bytes) > 2000
    wb = openpyxl.load_workbook(io.BytesIO(excel_bytes))
    sheet_names = wb.sheetnames
    assert "Table of Control" in sheet_names
    assert "Track Profile Table" in sheet_names
    assert "TSR Route Table" in sheet_names
    assert "TSL Working Table" in sheet_names

    # 7. Verify JSON export
    data_dict = JsonCsvExporter.to_dict(export)
    assert data_dict["summary"]["isXTractor"] is True
    assert data_dict["summary"]["totalRoutes"] >= 3
