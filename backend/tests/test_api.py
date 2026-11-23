"""End-to-end API test. Only the external DWG->DXF binary is replaced by a stand-in
script that emits a real DXF; upload, worker process, rendering and serving are real."""
import gzip
import os
import stat
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
from cadr_decode import decode  # noqa: E402
from make_sample import make  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    sample = tmp_path / "sample.dxf"
    make(str(sample))
    from app.config import settings
    if sys.platform == "win32":
        stub = tmp_path / "bin" / "dwg2dxf.bat"
        stub.parent.mkdir(parents=True, exist_ok=True)
        stub.write_text(f'@echo off\ncopy /Y "{sample}" "%3" >nul\nexit /b 0\n')
        monkeypatch.setattr(settings, "libredwg_dwg2dxf_path", str(stub))
        monkeypatch.setenv("LIBREDWG_DWG2DXF_PATH", str(stub))
    else:
        stub = tmp_path / "bin" / "dwg2dxf"
        stub.parent.mkdir(parents=True, exist_ok=True)
        stub.write_text(f'#!/bin/sh\n[ "$1" = "-y" ] && shift\n[ "$1" = "-o" ] && cp "{sample}" "$2"\n')
        stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        monkeypatch.setenv("PATH", f"{stub.parent}:{os.environ['PATH']}")
        monkeypatch.setattr(settings, "libredwg_dwg2dxf_path", str(stub))
        monkeypatch.setenv("LIBREDWG_DWG2DXF_PATH", str(stub))

    monkeypatch.setenv("CONVERTER_ORDER", "libredwg")
    monkeypatch.setenv("TEMP_DIR", str(tmp_path / "temp"))  # inherited by the worker subprocess

    monkeypatch.setattr(settings, "temp_dir", tmp_path / "temp")
    monkeypatch.setattr(settings, "converter_order", "libredwg")
    from app.main import app
    with TestClient(app) as c:
        yield c


def _upload(client, name="station.dwg", data=b"AC1032" + b"\0" * 2048, mime="application/acad"):
    return client.post("/api/v1/cad/upload", files={"file": (name, data, mime)})


def _wait(client, job_id):
    for _ in range(100):
        j = client.get(f"/api/v1/cad/jobs/{job_id}").json()
        if j["status"] in ("completed", "failed"):
            return j
        time.sleep(0.2)
    pytest.fail("timeout")


def test_full_pipeline(client):
    r = _upload(client)
    assert r.status_code == 200
    job = _wait(client, r.json()["jobId"])
    assert job["status"] == "completed" and job["progress"] == 100

    doc = client.get(f"/api/v1/cad/{job['jobId']}").json()
    assert [l["name"] for l in doc["layouts"]] == ["Model"]  # Model space is the primary layout
    assert doc["bounds"]["minX"] == -50 and doc["bounds"]["maxY"] == 1050  # coordinates intact

    blob = client.get(doc["renderUrl"]).content  # httpx transparently gunzips
    head, meta, verts = decode(blob)
    assert head["paths"] == len(meta) and head["vertices"] == len(verts)
    ox, oy = head["origin"]
    assert abs(verts[:, 0].min() + ox - (-50)) < 1e-2  # origin + offset == original coordinate

    assert client.get(f"/api/v1/cad/{job['jobId']}/original").content.startswith(b"AC1032")
    ref = client.get(f"/api/v1/cad/{job['jobId']}/reference?layout=0")
    assert ref.status_code == 200 and ref.content[:4] == b"\x89PNG"


@pytest.mark.parametrize("name,data,mime,code", [
    ("a.txt", b"AC1032xx", "text/plain", 415),
    ("a.dwg", b"AC1032xx", "text/html", 415),
    ("a.dwg", b"NOTADWGFILE", "application/acad", 422),
    ("a.dwg", b"", "application/acad", 422),
])
def test_rejects_invalid(client, name, data, mime, code):
    assert _upload(client, name, data, mime).status_code == code


def test_size_limit(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "max_upload_size_mb", 0)
    assert _upload(client).status_code == 413


def test_failure_is_sanitised(client, tmp_path):
    from app.services import job_store
    from app.config import settings
    stub = Path(settings.libredwg_dwg2dxf_path)
    if sys.platform == "win32":
        stub.write_text('@echo off\necho garbage > "%3"\nexit /b 0\n')
    else:
        stub.write_text('#!/bin/sh\n[ "$1" = "-y" ] && shift\necho garbage > "$2"\n')
    job = _wait(client, _upload(client).json()["jobId"])
    assert job["status"] == "failed"
    assert "Traceback" not in (job["error"] or "") and "unsupported CAD features" in job["error"]
    log = (job_store.job_dir(job["jobId"]) / "worker.log").read_text()
    assert "Traceback" in log  # full detail is kept server-side only


def test_bad_ids_and_cleanup(client, monkeypatch):
    assert client.get("/api/v1/cad/jobs/../../etc").status_code in (404, 422)
    assert client.get("/api/v1/cad/jobs/not-a-uuid").status_code == 404
    from app.config import settings
    from app.services import job_store
    jid = _wait(client, _upload(client).json()["jobId"])["jobId"]
    monkeypatch.setattr(settings, "temp_file_ttl_minutes", 0)
    time.sleep(0.05)
    assert job_store.purge_expired() >= 1
    assert client.get(f"/api/v1/cad/jobs/{jid}").status_code == 404


def test_modify_drawing(client):
    r = _upload(client)
    assert r.status_code == 200
    job = _wait(client, r.json()["jobId"])
    assert job["status"] == "completed"

    doc_id = job["jobId"]
    # Get initial components
    comp_resp = client.get(f"/api/v1/cad/{doc_id}/components")
    assert comp_resp.status_code == 200
    comps = comp_resp.json()["components"]

    # Modify one component if available, or test endpoint call
    mod_resp = client.post(f"/api/v1/cad/{doc_id}/modify", json={
        "moves": [{"id": comps[0]["id"] if comps else "dummy", "dx": 10.0, "dy": 5.0}],
        "updates": [],
        "deletions": []
    })
    assert mod_resp.status_code == 200
    assert "manifest" in mod_resp.json()

    # Test export dxf
    dxf_resp = client.get(f"/api/v1/cad/{doc_id}/export-dxf")
    assert dxf_resp.status_code == 200

