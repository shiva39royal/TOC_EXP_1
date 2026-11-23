import asyncio
import logging
import subprocess
import sys

from app.config import BASE_DIR, settings
from app.services import job_store

log = logging.getLogger("cad.runner")
_sem: asyncio.Semaphore | None = None
_tasks: set[asyncio.Task] = set()


def _run_subprocess_sync(args: list[str], job_id: str, timeout: int) -> int | None:
    logfile = open(job_store.job_dir(job_id) / "worker.log", "ab")
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.worker", *args],
            cwd=BASE_DIR,
            stdout=logfile,
            stderr=logfile,
        )
        try:
            return proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return None
    finally:
        logfile.close()


async def _spawn(args: list[str], job_id: str, timeout: int) -> int | None:
    return await asyncio.to_thread(_run_subprocess_sync, args, job_id, timeout)


async def _run_job(job_id: str) -> None:
    global _sem
    _sem = _sem or asyncio.Semaphore(settings.max_concurrent_jobs)
    state = job_store.read_job(job_id) or {}
    filename = state.get("fileName", "drawing.dwg")
    log.info("Started processing file: %s (Job ID: %s)", filename, job_id)
    job_store.write_job(job_id, status="processing", progress=3, stage="Queued")
    async with _sem:
        job_store.write_job(job_id, status="processing", progress=5, stage="Processing CAD drawing")
        rc = await _spawn(["run", job_id], job_id, settings.processing_timeout_seconds)
    state = job_store.read_job(job_id) or {}
    if rc == 0 and state.get("status") == "completed":
        log.info("Completed processing file: %s (Job ID: %s)", filename, job_id)
    else:
        why = "timed out" if rc is None else f"exited with code {rc}"
        if state.get("status") != "failed":
            log.error("Failed processing file %s: %s", filename, why)
            job_store.write_job(job_id, status="failed", stage="Failed",
                                error="Unable to display this DWG. The file may contain unsupported "
                                      "CAD features or may be corrupted.")
        else:
            log.error("Failed processing file %s: %s", filename, state.get("error"))


def start_job(job_id: str) -> None:
    task = asyncio.create_task(_run_job(job_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def make_reference(job_id: str, layout_id: int) -> bool:
    rc = await _spawn(["reference", job_id, str(layout_id)], job_id, 180)
    return rc == 0
