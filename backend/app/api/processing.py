"""CAD Processing and X-Tractor API Endpoints."""
from __future__ import annotations

import csv
import io
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from app.schemas.cad import DocumentResponse, JobResponse, LayoutInfo, ModifyDrawingRequest
from app.services import job_store
from app.services.job_runner import make_reference
from app.x_tractor.engine import XTractorEngine
from app.x_tractor.exporters.excel_exporter import ExcelExporter
from app.x_tractor.exporters.json_csv_exporter import JsonCsvExporter
from app.x_tractor.models.kavach_tables import FullKavachExport

log = logging.getLogger("cad.api.processing")
router = APIRouter()


def _job(job_id: str) -> dict:
    try:
        state = job_store.read_job(job_id)
    except ValueError:
        state = None
    if not state:
        raise HTTPException(404, "Job not found or expired.")
    job_store.touch(job_id)
    return state


def _completed(job_id: str) -> dict:
    state = _job(job_id)
    if state.get("status") != "completed":
        raise HTTPException(409, "Drawing is not ready.")
    return state


@router.get("/cad/jobs/{job_id}", response_model=JobResponse)
def job_status(job_id: str):
    s = _job(job_id)
    return JobResponse(
        jobId=job_id,
        fileName=s.get("fileName", ""),
        status=s["status"],
        progress=int(s.get("progress", 0)),
        stage=s.get("stage", ""),
        error=s.get("error")
    )


@router.get("/cad/{doc_id}", response_model=DocumentResponse)
def document(doc_id: str):
    s = _completed(doc_id)
    manifest = json.loads((job_store.job_dir(doc_id) / "render" / "manifest.json").read_text(encoding="utf-8"))
    model_layouts = [l for l in manifest["layouts"] if l.get("isModel", False)]
    active_layouts = model_layouts if model_layouts else manifest["layouts"]
    layouts = []
    for l in active_layouts:
        b = l.get("bounds")
        if isinstance(b, (list, tuple)) and len(b) >= 4:
            b = {"minX": b[0], "minY": b[1], "maxX": b[2], "maxY": b[3]}
        layouts.append(
            LayoutInfo(
                id=l["id"],
                name=l["name"],
                isModel=l["isModel"],
                entityCount=l["entityCount"],
                bounds=b,
                renderUrl=f"/api/v1/cad/{doc_id}/render?layout={l['id']}",
            )
        )
    default = next((l for l in layouts if l.isModel and l.bounds), None) \
        or next((l for l in layouts if l.bounds), layouts[0])

    meta = job_store.read_meta(doc_id)
    orig_file = job_store.job_dir(doc_id) / "original.dwg"
    file_name = s.get("fileName") or meta.get("fileName") or "drawing.dwg"
    file_size = s.get("fileSize") or meta.get("fileSize") or (orig_file.stat().st_size if orig_file.is_file() else 0)

    clean_warnings = [w for w in manifest.get("warnings", []) if "Paper-space" not in w]

    return DocumentResponse(
        id=doc_id,
        fileName=file_name,
        fileSize=file_size,
        bounds=default.bounds,
        renderUrl=default.renderUrl,
        defaultLayout=default.id,
        layouts=layouts,
        warnings=clean_warnings,
        converter=manifest.get("converter", ""),
        categories=manifest.get("categories", []),
        cadLayers=manifest.get("cadLayers", []),
        isFromTables=False
    )


@router.get("/cad/{doc_id}/components")
def components(doc_id: str):
    _completed(doc_id)
    comp_file = job_store.job_dir(doc_id) / "render" / "components.json"
    if not comp_file.is_file():
        return {"layers": [], "categories": [], "components": [], "totalComponents": 0}
    return json.loads(comp_file.read_text(encoding="utf-8"))


@router.get("/cad/{doc_id}/render")
def render(doc_id: str, request: Request, layout: int = 0):
    _completed(doc_id)
    f = job_store.job_dir(doc_id) / "render" / f"layout_{int(layout)}.cadr.gz"
    if not f.is_file():
        raise HTTPException(404, "Layout has no renderable geometry.")
    headers = {"Cache-Control": "private, max-age=3600"}
    if "gzip" in request.headers.get("accept-encoding", ""):
        return FileResponse(f, media_type="application/octet-stream", headers={**headers, "Content-Encoding": "gzip"})
    import gzip
    return Response(gzip.decompress(f.read_bytes()), media_type="application/octet-stream", headers=headers)


@router.get("/cad/{doc_id}/original")
def original(doc_id: str):
    s = _completed(doc_id)
    meta = job_store.read_meta(doc_id)
    file_name = s.get("fileName") or meta.get("fileName") or "drawing.dwg"
    return FileResponse(job_store.job_dir(doc_id) / "original.dwg", media_type="application/octet-stream", filename=file_name)


@router.get("/cad/{doc_id}/reference")
async def reference(doc_id: str, layout: int = 0):
    _completed(doc_id)
    png = job_store.job_dir(doc_id) / "render" / f"reference_{int(layout)}.png"
    if not png.is_file() and not (await make_reference(doc_id, int(layout))):
        raise HTTPException(500, "Reference image could not be generated.")
    return FileResponse(png, media_type="image/png")


@router.post("/cad/{doc_id}/modify")
def modify_drawing(doc_id: str, req: ModifyDrawingRequest):
    _completed(doc_id)
    job_d = job_store.job_dir(doc_id)
    dxf_file = job_d / "processed" / "drawing.dxf"
    render_d = job_d / "render"
    dwg_file = job_d / "original.dwg"
    if not dxf_file.is_file():
        raise HTTPException(404, "Editable DXF not found for this drawing.")

    from app.services.dxf_mutator import apply_modifications
    try:
        res = apply_modifications(
            dxf_path=dxf_file,
            render_dir=render_d,
            moves=[m.model_dump() for m in req.moves],
            updates=[u.model_dump() for u in req.updates],
            deletions=req.deletions,
            additions=[a.model_dump() for a in req.additions],
            dwg_path=dwg_file if dwg_file.is_file() else None,
        )
        # Invalidate cached X-Tractor tables
        tables_cache = render_d / "kavach_tables.json"
        if tables_cache.is_file():
            try:
                tables_cache.unlink()
            except Exception:
                pass
        return res
    except Exception as ex:
        raise HTTPException(500, f"Failed to modify CAD drawing: {ex}")


@router.get("/cad/{doc_id}/export-dxf")
def export_dxf(doc_id: str):
    s = _completed(doc_id)
    job_d = job_store.job_dir(doc_id)
    dxf_file = job_d / "processed" / "drawing.dxf"
    if not dxf_file.is_file():
        raise HTTPException(404, "DXF not found.")
    meta = job_store.read_meta(doc_id)
    file_name = s.get("fileName") or meta.get("fileName") or "drawing.dwg"
    base_name = file_name.rsplit(".", 1)[0]
    return FileResponse(dxf_file, media_type="application/dxf", filename=f"{base_name}_modified.dxf")


@router.delete("/cad/{doc_id}", status_code=204)
def delete(doc_id: str):
    _job(doc_id)
    job_store.delete_job(doc_id)


# ==============================================================================
# X-TRACTOR: RDSO KAVACH CONTROL TABLE SYNTHESIS ENDPOINTS
# ==============================================================================

def _get_or_run_xtractor(doc_id: str) -> FullKavachExport:
    _completed(doc_id)
    job_d = job_store.job_dir(doc_id)
    cache_file = job_d / "render" / "kavach_tables.json"

    if cache_file.is_file():
        try:
            cached_dict = json.loads(cache_file.read_text(encoding="utf-8"))
            return FullKavachExport.model_validate(cached_dict)
        except Exception as e:
            log.warning("Cache load failed, re-running X-Tractor: %s", e)

    dxf_file = job_d / "processed" / "drawing.dxf"
    dwg_file = job_d / "original.dwg"
    if not dxf_file.is_file():
        raise HTTPException(404, "Drawing DXF file not found for extraction.")

    kavach_data = XTractorEngine.extract_from_dxf(
        dxf_path=dxf_file,
        dwg_path=dwg_file if dwg_file.is_file() else None
    )

    try:
        cache_file.write_text(JsonCsvExporter.to_json(kavach_data), encoding="utf-8")
    except Exception as e:
        log.warning("Failed to cache X-Tractor results: %s", e)

    return kavach_data


@router.get("/cad/{doc_id}/x-tractor")
def get_x_tractor_tables(doc_id: str) -> dict[str, Any]:
    """Returns all synthesized RDSO KAVACH tables: TOC, Block Section, Shunting, Track Profile, TSR, TSL."""
    data = _get_or_run_xtractor(doc_id)
    return JsonCsvExporter.to_dict(data)


@router.post("/cad/{doc_id}/x-tractor/update")
def update_x_tractor_tables(doc_id: str, updated_data: FullKavachExport) -> dict[str, Any]:
    """Persists user edits to the synthesized KAVACH tables."""
    _completed(doc_id)
    job_d = job_store.job_dir(doc_id)
    cache_file = job_d / "render" / "kavach_tables.json"
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        cache_file.write_text(JsonCsvExporter.to_json(updated_data), encoding="utf-8")
        log.info("Persisted manual table edits for doc %s", doc_id)
    except Exception as e:
        log.error("Failed to persist updated tables for doc %s: %s", doc_id, e)
        raise HTTPException(500, f"Failed to save table edits: {e}")
    return {"status": "success", "message": "Tables updated successfully"}


@router.get("/cad/{doc_id}/x-tractor/excel")
def export_x_tractor_excel(doc_id: str):
    """Generates and streams an authentic multi-tab Microsoft Excel (.xlsx) workbook matching the RDSO specification."""
    data = _get_or_run_xtractor(doc_id)
    excel_bytes = ExcelExporter.export_workbook(data)
    stn_code = data.station_meta.station_code or data.station_meta.station_name.replace(" ", "_")
    filename = f"RDSO_KAVACH_{stn_code}_{doc_id[:8]}.xlsx"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
    return Response(excel_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.get("/cad/{doc_id}/x-tractor/excel/{sheet_key}")
def export_x_tractor_single_excel(doc_id: str, sheet_key: str):
    """Exports an individual KAVACH table as Microsoft Excel (.xlsx)."""
    data = _get_or_run_xtractor(doc_id)
    excel_bytes = ExcelExporter.export_single_sheet(data, sheet_key)
    stn_code = data.station_meta.station_code or data.station_meta.station_name.replace(" ", "_")
    filename = f"RDSO_{sheet_key}_{stn_code}_{doc_id[:8]}.xlsx"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
    return Response(excel_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.get("/cad/{doc_id}/x-tractor/export/{table_name}")
def export_x_tractor_csv(doc_id: str, table_name: str):
    """Exports an individual KAVACH table as RFC 4180 CSV."""
    data = _get_or_run_xtractor(doc_id)
    rows_map = {
        "table_of_control": data.table_of_control,
        "block_section": data.block_section_details,
        "shunting_limits": data.shunting_limits,
        "track_profile": data.track_profiles,
        "tsr_routes": data.tsr_routes,
        "tsl_routes": data.tsl_routes
    }
    if table_name not in rows_map:
        raise HTTPException(400, f"Unknown table name: {table_name}. Valid tables: {list(rows_map.keys())}")

    csv_text = JsonCsvExporter.export_csv(rows_map[table_name])
    filename = f"{table_name}_{doc_id[:8]}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(csv_text, media_type="text/csv", headers=headers)


# Backward-compatible alias
@router.get("/cad/{doc_id}/cikms-tables")
def get_cikms_tables_compat(doc_id: str):
    """Backward compatibility alias returning X-Tractor KAVACH tables."""
    return get_x_tractor_tables(doc_id)
