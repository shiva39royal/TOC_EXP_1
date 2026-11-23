"""Isolated worker process.  `python -m app.worker run <jobId>` / `reference <jobId> <layoutId>`.

Running heavy CAD work in a child process keeps the API responsive and lets the
parent enforce a hard timeout by killing it.
"""
from __future__ import annotations

import logging
import sys

from app.config import settings
from app.services import job_store, render_service
from app.services.dwg_processor import get_processor

USER_ERROR = ("Unable to display this DWG. The file may contain unsupported CAD "
              "features or may be corrupted.")


def run(job_id: str) -> int:
    d = job_store.job_dir(job_id)
    log = logging.getLogger("cad.worker")
    state = job_store.read_job(job_id) or {}
    filename = state.get("fileName", "drawing.dwg")
    last_logged_bucket = [-1]

    def update(status: str, progress: int, stage: str) -> None:
        job_store.write_job(job_id, status=status, progress=progress, stage=stage)
        bucket = progress // 20
        if bucket > last_logged_bucket[0]:
            last_logged_bucket[0] = bucket
            log.info("[%s] Progress: %d%% - %s", filename, progress, stage)

    try:
        manifest = get_processor().process(d / "original.dwg", d, update)
        if getattr(settings, "purge_raw_dwg", False):
            raw_dwg = d / "original.dwg"
            if raw_dwg.is_file():
                try:
                    raw_dwg.unlink(missing_ok=True)
                    log.info("[%s] Raw DWG file automatically purged from disk", filename)
                except Exception:
                    pass

        job_store.write_job(job_id, status="completed", progress=100, stage="Complete",
                            error=None, converter=manifest.get("converter", ""))
        log.info("[%s] Progress: 100%% - Complete", filename)
        return 0
    except Exception as exc:
        log.error("[%s] Processing failed: %s", filename, exc)
        job_store.write_job(job_id, status="failed", stage="Failed", error=USER_ERROR)
        return 1


def reference(job_id: str, layout_id: int) -> int:
    d = job_store.job_dir(job_id)
    render_service.render_reference_png(
        d / "processed" / "drawing.dxf", layout_id, d / "render" / f"reference_{layout_id}.png")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("ezdxf").setLevel(logging.WARNING)
    mode = sys.argv[1]
    if mode == "run":
        sys.exit(run(sys.argv[2]))
    sys.exit(reference(sys.argv[2], int(sys.argv[3])))
