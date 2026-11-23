"""Excel workbook generator for RDSO KAVACH Control Tables using openpyxl."""
from __future__ import annotations

import io
import logging
from typing import Any

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.x_tractor.models.kavach_tables import FullKavachExport

log = logging.getLogger("x_tractor.excel_exporter")

# RDSO Standard Styling Accents
NAVY_HEADER_FILL = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
STEEL_HEADER_FILL = PatternFill(start_color="335A80", end_color="335A80", fill_type="solid")
SUB_HEADER_FILL = PatternFill(start_color="E6EEF8", end_color="E6EEF8", fill_type="solid")
WHITE_BOLD_FONT = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
DARK_BOLD_FONT = Font(name="Calibri", size=10, bold=True, color="000000")
REGULAR_FONT = Font(name="Calibri", size=9, bold=False, color="000000")

THIN_SIDE = Side(border_style="thin", color="CCCCCC")
THIN_BORDER = Border(left=THIN_SIDE, right=THIN_SIDE, top=THIN_SIDE, bottom=THIN_SIDE)
HEADER_BORDER = Border(left=THIN_SIDE, right=THIN_SIDE, top=THIN_SIDE, bottom=Side(border_style="medium", color="1B365D"))


class ExcelExporter:
    """Renders FullKavachExport data into an authentic multi-sheet RDSO Excel workbook."""

    @classmethod
    def export_workbook(cls, data: FullKavachExport) -> bytes:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)  # remove default blank sheet

        # 1. Sheet 1: KAVACH Table of Control
        ws_toc = wb.create_sheet(title="Table of Control")
        cls._render_station_banner(ws_toc, data, "KAVACH Table of Control")
        cls._render_toc_sheet(ws_toc, data)

        # 2. Sheet 2: KAVACH Track Profile Table
        ws_prof = wb.create_sheet(title="Track Profile Table")
        cls._render_station_banner(ws_prof, data, "KAVACH Track Profile Table")
        cls._render_profile_sheet(ws_prof, data)

        # 3. Sheet 3: TSR Route Table
        ws_tsr = wb.create_sheet(title="TSR Route Table")
        cls._render_station_banner(ws_tsr, data, "KAVACH TSR Route Table")
        cls._render_tsr_sheet(ws_tsr, data)

        # 4. Sheet 4: TSL Working on Double Line Table
        ws_tsl = wb.create_sheet(title="TSL Working Table")
        cls._render_station_banner(ws_tsl, data, "Temporary Single Line Working on Double Line Table")
        cls._render_tsl_sheet(ws_tsl, data)

        # Auto-adjust column widths
        for ws in wb.worksheets:
            for col in ws.columns:
                max_len = max(len(str(cell.value or "")) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 11), 45)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    @staticmethod
    def _render_station_banner(ws: Any, data: FullKavachExport, table_title: str) -> None:
        meta = data.station_meta
        ws.row_dimensions[1].height = 24
        ws.row_dimensions[2].height = 20

        # Title Block
        ws.merge_cells("A1:C1")
        ws["A1"] = f"Station Name: {meta.station_name}"
        ws["A1"].font = DARK_BOLD_FONT

        ws.merge_cells("D1:F1")
        ws["D1"] = f"Division: {meta.division}"
        ws["D1"].font = DARK_BOLD_FONT

        ws.merge_cells("A2:C2")
        ws["A2"] = f"Station ID: {meta.station_id}"
        ws["A2"].font = DARK_BOLD_FONT

        ws.merge_cells("D2:F2")
        ws["D2"] = f"Section: {meta.section or 'SC Railway'}"
        ws["D2"].font = DARK_BOLD_FONT

        ws.merge_cells("G1:N2")
        ws["G1"] = table_title.upper()
        ws["G1"].font = Font(name="Calibri", size=13, bold=True, color="1B365D")
        ws["G1"].alignment = Alignment(horizontal="center", vertical="center")

    @classmethod
    def _render_toc_sheet(cls, ws: Any, data: FullKavachExport) -> None:
        headers = [
            "S. No", "Entry Signal", "Exit Signal", "Section Type", "Line", "Signal Type",
            "Aspects of Entry Signal", "Requires Aspects of Exit Signal",
            "Requires Points in Route (Normal)", "Requires Points in Route (Reverse)",
            "Requires Track Circuit 'UP' in Route", "TINs Requires Free", "TINs in Overlap",
            "Entry Signal Foot Tag", "Check RFID Sequence (Linking Distance, En-Route Tag)",
            "Distance between Signals (m)", "Movement Authority (in Sections)", "Authorized Speed In OS (kmph)"
        ]
        start_row = 4
        ws.row_dimensions[start_row].height = 28
        for col_idx, h in enumerate(headers, 1):
            cell = ws.cell(row=start_row, column=col_idx, value=h)
            cell.fill = NAVY_HEADER_FILL
            cell.font = WHITE_BOLD_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = HEADER_BORDER

        r_idx = start_row + 1
        for row in data.table_of_control:
            ws.row_dimensions[r_idx].height = 22
            values = [
                row.s_no, row.entry_signal, row.exit_signal, row.section_type, row.line, row.signal_type,
                row.aspect_entry_signal, row.requires_aspect_exit_signal, row.points_normal, row.points_reverse,
                row.requires_track_ckt_up, row.tins_requires_free, row.tins_requires_free_overlap,
                row.entry_signal_foot_tag, row.rfid_sequence_str, row.distance_between_signals_m,
                row.movement_authority, row.authorized_speed_os
            ]
            for c_idx, val in enumerate(values, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=val)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center" if c_idx not in (15,) else "left", vertical="center")
                c.border = THIN_BORDER
            r_idx += 1

        # Render Block Section Details Table below TOC
        r_idx += 2
        ws.cell(row=r_idx, column=1, value="BLOCK SECTION DETAILS").font = DARK_BOLD_FONT
        r_idx += 1
        b_headers = [
            "Last Stop Signal", "Distance to Next Signal (m)", "Block Section TIN",
            "Movement Up/Down", "Adjacent Line TINs", "Next Station ID",
            "Next Station Border RFID with Location", "Authorised Speed",
            "Start Dist to Abs Reset (m)", "Abs Correction (m)", "Loco Direction"
        ]
        for c_idx, bh in enumerate(b_headers, 1):
            c = ws.cell(row=r_idx, column=c_idx, value=bh)
            c.fill = STEEL_HEADER_FILL
            c.font = WHITE_BOLD_FONT
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.border = THIN_BORDER
        r_idx += 1

        for brow in data.block_section_details:
            b_vals = [
                brow.last_stop_signal, brow.distance_to_next_stop_signal_m, brow.block_section_tin,
                brow.movement_direction, brow.adjacent_line_tins, brow.next_station_id,
                brow.next_station_border_rfid_location, brow.authorised_speed,
                brow.start_dist_abs_loc_reset_m, brow.abs_loc_correction_m, brow.loco_direction_after_adj
            ]
            for c_idx, bv in enumerate(b_vals, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=bv)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border = THIN_BORDER
            r_idx += 1

    @classmethod
    def _render_profile_sheet(cls, ws: Any, data: FullKavachExport) -> None:
        headers = [
            "S. No", "Entry Signal", "Exit Signal", "Line",
            "Turnout Speed (kmph)", "Turnout Start Dist (m)", "Turnout Length (m)",
            "Permanent Speed Restriction (PSR)", "Engineering Gradient", "Average Gradient Value", "Gradient Length (m)",
            "LC Distance (m)", "LC ID", "LC Manning Type", "LC Class", "LC Whistling",
            "Track Condition Type", "Condition Start (m)", "Condition Length (m)"
        ]
        start_row = 4
        ws.row_dimensions[start_row].height = 28
        for col_idx, h in enumerate(headers, 1):
            c = ws.cell(row=start_row, column=col_idx, value=h)
            c.fill = NAVY_HEADER_FILL
            c.font = WHITE_BOLD_FONT
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            c.border = HEADER_BORDER

        r_idx = start_row + 1
        for row in data.track_profiles:
            ws.row_dimensions[r_idx].height = 24
            vals = [
                row.s_no, row.entry_signal, row.exit_signal, row.line,
                row.turnout_speed_kmph, row.turnout_start_dist_m, row.turnout_length_m,
                row.psr_str, row.engineering_gradients_str, row.average_gradient_value, row.gradient_length_m,
                row.lc_distance_m, row.lc_id, row.lc_manning_type, row.lc_class, row.lc_auto_whistling,
                row.track_condition_type, row.track_condition_start_m, row.track_condition_length_m
            ]
            for c_idx, val in enumerate(vals, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=val)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                c.border = THIN_BORDER
            r_idx += 1

    @classmethod
    def _render_tsr_sheet(cls, ws: Any, data: FullKavachExport) -> None:
        headers = [
            "S. No", "Entry Signal", "Exit Signal", "OHE Line", "OHE Line Start RFID Tag",
            "TSR Route ID", "Entry Signal Dist from OHE Start (m)", "Last Pole Dist from Exit (m)",
            "OHE Pole / Km Data (in meter)"
        ]
        start_row = 4
        ws.row_dimensions[start_row].height = 28
        for col_idx, h in enumerate(headers, 1):
            c = ws.cell(row=start_row, column=col_idx, value=h)
            c.fill = NAVY_HEADER_FILL
            c.font = WHITE_BOLD_FONT
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            c.border = HEADER_BORDER

        r_idx = start_row + 1
        for row in data.tsr_routes:
            ws.row_dimensions[r_idx].height = 22
            vals = [
                row.s_no, row.entry_signal, row.exit_signal, row.ohe_line, row.ohe_line_start_rfid_tag,
                row.tsr_route_id, row.entry_signal_dist_from_ohe_start_m, row.last_pole_dist_from_exit_signal_m,
                row.ohe_pole_km_data
            ]
            for c_idx, val in enumerate(vals, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=val)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center" if c_idx != 9 else "left", vertical="center")
                c.border = THIN_BORDER
            r_idx += 1

    @classmethod
    def _render_tsl_sheet(cls, ws: Any, data: FullKavachExport) -> None:
        headers = [
            "TSL Entry Signal", "TSL Exit Signal", "Signal Type", "Aspect of Entry Signal",
            "Requires Aspect of Exit Signal", "Required Route Command", "Requires Points in Route (Normal)",
            "Requires Points in Route (Reverse)", "Requires Track Ckt Up for Exit", "TINs Requires Free",
            "Entry Signal Foot Tag", "Check RFID Sequence with Linking Distance",
            "Distance between Signals (m)", "Movement Authority", "Authorized Speed in OS"
        ]
        start_row = 4
        ws.row_dimensions[start_row].height = 28
        for col_idx, h in enumerate(headers, 1):
            c = ws.cell(row=start_row, column=col_idx, value=h)
            c.fill = NAVY_HEADER_FILL
            c.font = WHITE_BOLD_FONT
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            c.border = HEADER_BORDER

        r_idx = start_row + 1
        for row in data.tsl_routes:
            ws.row_dimensions[r_idx].height = 22
            vals = [
                row.tsl_entry_signal, row.tsl_exit_signal, row.signal_type, row.aspect_entry_signal,
                row.requires_aspect_exit_signal, row.required_route_command, row.points_normal,
                row.points_reverse, row.requires_track_ckt_up, row.tins_requires_free,
                row.entry_signal_foot_tag, row.rfid_sequence_str, row.distance_between_signals_m,
                row.movement_authority, row.authorized_speed_os
            ]
            for c_idx, val in enumerate(vals, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=val)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center" if c_idx != 12 else "left", vertical="center")
                c.border = THIN_BORDER
            r_idx += 1

    @classmethod
    def _render_shunting_sheet(cls, ws: Any, data: FullKavachExport) -> None:
        headers = [
            "Adjacent Station Name", "Direction (Nominal/Reverse)", "RFID Tag No", "TIN", "Absolute Location (m)"
        ]
        start_row = 4
        ws.row_dimensions[start_row].height = 28
        for col_idx, h in enumerate(headers, 1):
            c = ws.cell(row=start_row, column=col_idx, value=h)
            c.fill = NAVY_HEADER_FILL
            c.font = WHITE_BOLD_FONT
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.border = HEADER_BORDER

        r_idx = start_row + 1
        for row in data.shunting_limits:
            ws.row_dimensions[r_idx].height = 22
            vals = [row.adjacent_station_name, row.direction, row.rfid_tag_no, row.tin, row.absolute_location_m]
            for c_idx, val in enumerate(vals, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=val)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border = THIN_BORDER
            r_idx += 1

    @classmethod
    def _render_block_section_only(cls, ws: Any, data: FullKavachExport) -> None:
        headers = [
            "Last Stop Signal", "Distance to Next Stop Signal (m)", "Block Section TIN",
            "Movement Up/Down", "Adjacent Line TINs", "Next Station ID",
            "Next Station Border RFID with Location", "Authorised Speed",
            "Start Dist to Abs Reset (m)", "Abs Correction (m)", "Loco Direction"
        ]
        start_row = 4
        ws.row_dimensions[start_row].height = 28
        for col_idx, h in enumerate(headers, 1):
            c = ws.cell(row=start_row, column=col_idx, value=h)
            c.fill = NAVY_HEADER_FILL
            c.font = WHITE_BOLD_FONT
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.border = HEADER_BORDER

        r_idx = start_row + 1
        for brow in data.block_section_details:
            b_vals = [
                brow.last_stop_signal, brow.distance_to_next_stop_signal_m, brow.block_section_tin,
                brow.movement_direction, brow.adjacent_line_tins, brow.next_station_id,
                brow.next_station_border_rfid_location, brow.authorised_speed,
                brow.start_dist_abs_loc_reset_m, brow.abs_loc_correction_m, brow.loco_direction_after_adj
            ]
            for c_idx, bv in enumerate(b_vals, 1):
                c = ws.cell(row=r_idx, column=c_idx, value=bv)
                c.font = REGULAR_FONT
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border = THIN_BORDER
            r_idx += 1

    @classmethod
    def export_single_sheet(cls, data: FullKavachExport, sheet_key: str) -> bytes:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        key = sheet_key.lower().replace("-", "_")

        if key in ("table_of_control", "toc"):
            ws = wb.create_sheet(title="Table of Control")
            cls._render_station_banner(ws, data, "KAVACH Table of Control")
            cls._render_toc_sheet(ws, data)
        elif key in ("track_profile", "profile", "track_profiles"):
            ws = wb.create_sheet(title="Track Profile Table")
            cls._render_station_banner(ws, data, "KAVACH Track Profile Table")
            cls._render_profile_sheet(ws, data)
        elif key in ("tsr_routes", "tsr"):
            ws = wb.create_sheet(title="TSR Route Table")
            cls._render_station_banner(ws, data, "KAVACH TSR Route Table")
            cls._render_tsr_sheet(ws, data)
        elif key in ("tsl_routes", "tsl"):
            ws = wb.create_sheet(title="TSL Working Table")
            cls._render_station_banner(ws, data, "Temporary Single Line Working on Double Line Table")
            cls._render_tsl_sheet(ws, data)
        elif key in ("block_section", "block", "block_section_details"):
            ws = wb.create_sheet(title="Block Section Details")
            cls._render_station_banner(ws, data, "KAVACH Block Section Details")
            cls._render_block_section_only(ws, data)
        elif key in ("shunting_limits", "shunting"):
            ws = wb.create_sheet(title="Shunting Limits")
            cls._render_station_banner(ws, data, "KAVACH Shunting Limits Table")
            cls._render_shunting_sheet(ws, data)
        else:
            return cls.export_workbook(data)

        for ws in wb.worksheets:
            for col in ws.columns:
                max_len = max(len(str(cell.value or "")) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 11), 45)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()
