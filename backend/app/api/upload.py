import logging
import re
import shutil
from pathlib import Path

# aiofiles removed for standard async file reading
from fastapi import APIRouter, HTTPException, UploadFile

from app.config import BASE_DIR, settings
from app.schemas.cad import UploadResponse
from app.services import job_store
from app.services.cad_converter import available_converters
from app.services.job_runner import start_job

log = logging.getLogger("cad.upload")
router = APIRouter()

ALLOWED_MIME = {"", "application/octet-stream", "application/acad", "application/x-acad",
                "application/dwg", "application/x-dwg", "image/vnd.dwg", "image/x-dwg",
                "application/autocad_dwg", "drawing/dwg"}
CHUNK = 1024 * 1024


def _safe_name(name: str) -> str:
    base = Path(name.replace("\\", "/")).name
    return re.sub(r"[\x00-\x1f<>:\"|?*]", "_", base)[:200] or "drawing.dwg"


@router.post("/cad/upload", response_model=UploadResponse)
async def upload(file: UploadFile):
    name = _safe_name(file.filename or "")
    if not name.lower().endswith(".dwg"):
        raise HTTPException(415, "Only DWG files are supported.")
    if (file.content_type or "").split(";")[0].strip().lower() not in ALLOWED_MIME:
        raise HTTPException(415, "Only DWG files are supported.")
    if not available_converters():
        raise HTTPException(503, "No DWG converter is installed on the server.")

    # Purge any expired jobs
    job_store.purge_expired()

    job_id = job_store.new_job_id()
    d = job_store.job_dir(job_id)
    d.mkdir(parents=True)
    target = d / "original.dwg"
    size = 0
    try:
        with open(target, "wb") as out:
            while chunk := await file.read(CHUNK):
                if size == 0 and not chunk.startswith(b"AC1"):  # DWG version signature
                    raise HTTPException(422, "This file is not a valid DWG drawing.")
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(413, f"File exceeds the {settings.max_upload_size_mb} MB limit.")
                out.write(chunk)
        if size == 0:
            raise HTTPException(422, "The file is empty.")
    except BaseException:
        job_store.delete_job(job_id)
        raise

    log.info("Uploaded file: %s (%.2f MB) [Job ID: %s]", name, size / (1024 * 1024), job_id)
    job_store.save_meta(job_id, fileName=name, fileSize=size)
    job_store.write_job(job_id, fileName=name, fileSize=size, status="processing",
                        progress=2, stage="Queued", error=None)
    start_job(job_id)
    return UploadResponse(jobId=job_id, fileName=name, status="processing")


@router.post("/cad/clean")
async def clean_temp():
    """Wipes all previous job directories and loose files from backend/temp."""
    removed = job_store.cleanup_temp_dir()
    log.info("Cleaned temp directory (removed %d item(s))", removed)
    return {"status": "ok", "removed": removed}


@router.delete("/cad/{doc_id}")
async def delete_session(doc_id: str):
    """Deletes a specific session directory completely."""
    job_store.delete_job(doc_id)
    return {"status": "deleted", "doc_id": doc_id}


@router.get("/cad/samples")
async def list_sample_dwgs():
    """Dynamically lists all available .dwg drawings found in the workspace root."""
    dwgs = []
    root = BASE_DIR.parent
    for p in root.glob("*.dwg"):
        if p.is_file():
            dwgs.append({"fileName": p.name, "fileSize": p.stat().st_size})
    return dwgs


@router.post("/cad/load-sample/{filename:path}", response_model=UploadResponse)
async def load_sample_dwg(filename: str):
    """Dynamically loads and starts processing for any drawing file found in the workspace."""
    root = BASE_DIR.parent
    target = (root / filename).resolve()
    # Security: ensure file stays within root directory and is a .dwg file
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(403, "Access denied.")

    if not target.is_file() or not target.name.lower().endswith(".dwg"):
        raise HTTPException(404, "Drawing file not found.")

    if not available_converters():
        raise HTTPException(503, "No DWG converter is installed on the server.")

    job_store.purge_expired()
    job_id = job_store.new_job_id()
    d = job_store.job_dir(job_id)
    d.mkdir(parents=True)
    dst = d / "original.dwg"
    shutil.copyfile(target, dst)
    size = target.stat().st_size

    log.info("Loaded sample drawing: %s (%.2f MB) [Job ID: %s]", target.name, size / (1024 * 1024), job_id)
    job_store.save_meta(job_id, fileName=target.name, fileSize=size)
    job_store.write_job(job_id, fileName=target.name, fileSize=size, status="processing",
                        progress=2, stage="Queued", error=None)
    start_job(job_id)
    return UploadResponse(jobId=job_id, fileName=target.name, status="processing")


