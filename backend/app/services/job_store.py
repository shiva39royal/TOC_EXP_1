"""File-based job state (no database). One directory per job under TEMP_DIR."""
from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path

from app.config import settings

ACTIVE = {"uploading", "processing", "converting", "preparing", "rendering"}


def new_job_id() -> str:
    return str(uuid.uuid4())


def job_dir(job_id: str) -> Path:
    """Resolves a job directory. Raises ValueError for anything that is not a UUID."""
    return settings.temp_dir / str(uuid.UUID(job_id))


def save_meta(job_id: str, fileName: str, fileSize: int) -> None:
    """Persists immutable metadata on upload so fileName/fileSize are never lost."""
    try:
        d = job_dir(job_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(
            json.dumps({"fileName": fileName, "fileSize": fileSize}),
            encoding="utf-8",
        )
    except (ValueError, OSError):
        pass


def read_meta(job_id: str) -> dict:
    """Reads immutable upload metadata."""
    try:
        p = job_dir(job_id) / "meta.json"
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        pass
    return {}


def read_job(job_id: str) -> dict | None:
    try:
        path = job_dir(job_id) / "job.json"
    except ValueError:
        return None

    for attempt in range(6):
        try:
            if not path.is_file():
                return None
            state = json.loads(path.read_text(encoding="utf-8"))
            meta = read_meta(job_id)
            if meta:
                for k in ("fileName", "fileSize"):
                    if k not in state and k in meta:
                        state[k] = meta[k]
            return state
        except (json.JSONDecodeError, OSError):
            if attempt < 5:
                time.sleep(0.015 * (attempt + 1))
            else:
                return None
    return None


def write_job(job_id: str, **fields) -> dict:
    d = job_dir(job_id)
    d.mkdir(parents=True, exist_ok=True)
    target = d / "job.json"

    state = read_job(job_id) or {"jobId": job_id, "createdAt": time.time()}
    meta = read_meta(job_id)
    if meta:
        for k in ("fileName", "fileSize"):
            if k not in state and k not in fields and k in meta:
                state[k] = meta[k]

    state.update(fields)
    state["updatedAt"] = time.time()

    tmp = d / f"job.json.{os.getpid()}.{time.time_ns()}.tmp"
    tmp.write_text(json.dumps(state), encoding="utf-8")

    for attempt in range(8):
        try:
            os.replace(tmp, target)
            break
        except OSError:
            if attempt < 7:
                time.sleep(0.015 * (attempt + 1))
            else:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
    return state


def touch(job_id: str) -> None:
    try:
        p = job_dir(job_id) / "job.json"
        if p.is_file():
            os.utime(p, None)
    except (ValueError, OSError):
        pass


def delete_job(job_id: str) -> None:
    shutil.rmtree(job_dir(job_id), ignore_errors=True)


def purge_expired() -> int:
    """Deletes job directories that have not been touched within the TTL."""
    ttl = settings.temp_file_ttl_minutes * 60
    now, removed = time.time(), 0
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    for d in settings.temp_dir.iterdir():
        if not d.is_dir():
            continue
        state = read_job(d.name) or {}
        j_file = d / "job.json"
        try:
            file_mtime = j_file.stat().st_mtime if j_file.is_file() else d.stat().st_mtime
        except OSError:
            file_mtime = 0
        last = max(state.get("lastAccess", 0), state.get("updatedAt", 0), state.get("createdAt", 0), file_mtime)
        if not last:
            last = file_mtime
        # Active jobs are bounded by the processing timeout; allow that on top of the TTL.
        grace = settings.processing_timeout_seconds if state.get("status") in ACTIVE else 0
        if now - last > ttl + grace:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed


def cleanup_temp_dir(exclude_job_id: str | None = None) -> int:
    """Removes all previous job directories and loose files from temp directory."""
    removed = 0
    if not settings.temp_dir.exists():
        return 0
    for item in settings.temp_dir.iterdir():
        if exclude_job_id and item.name == exclude_job_id:
            continue
        try:
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
                removed += 1
            elif item.is_file():
                item.unlink(missing_ok=True)
                removed += 1
        except Exception:
            pass
    return removed


