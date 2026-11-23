"""DWG -> DXF conversion strategies.

Each converter wraps one external engine. The rest of the app only sees
`convert_dwg_to_dxf()`, so engines can be swapped or reordered through
`CONVERTER_ORDER` without touching the renderer.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path

from app.config import settings

log = logging.getLogger("cad.converter")


class ConversionError(RuntimeError):
    pass


class CadConverter(ABC):
    name: str

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def convert(self, dwg: Path, out_dxf: Path, timeout: int) -> None: ...


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    log.info("exec: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


class OdaConverter(CadConverter):
    """ODA File Converter (Teigha). Highest fidelity; needs a separate install."""

    name = "oda"

    def _get_executable(self) -> str | None:
        p = Path(settings.oda_converter_path)
        if p.exists():
            return str(p)
        if shutil.which(settings.oda_converter_path):
            return settings.oda_converter_path
        from app.config import BASE_DIR
        local_tool = BASE_DIR / "tools" / "oda" / "ODAFileConverter.exe"
        if local_tool.exists():
            return str(local_tool)
        return None

    def available(self) -> bool:
        return self._get_executable() is not None

    def convert(self, dwg: Path, out_dxf: Path, timeout: int) -> None:
        exe = self._get_executable()
        if not exe:
            raise ConversionError("ODAFileConverter executable not found.")
        with tempfile.TemporaryDirectory(dir=out_dxf.parent) as tmp:
            src, dst = Path(tmp, "in"), Path(tmp, "out")
            src.mkdir(), dst.mkdir()
            shutil.copy(dwg, src / "input.dwg")
            cmd = [exe, str(src), str(dst),
                   settings.oda_output_version, "DXF", "0", "1", "*.dwg"]
            # The converter is a Qt app: give it a virtual display when headless.
            if not os.environ.get("DISPLAY") and shutil.which("xvfb-run"):
                cmd = ["xvfb-run", "-a", *cmd]
            res = _run(cmd, timeout)
            produced = next(dst.glob("*.dxf"), None)
            if produced is None or produced.stat().st_size == 0:
                raise ConversionError(f"ODA produced no DXF (rc={res.returncode}): {res.stderr[-500:]}")
            shutil.move(str(produced), out_dxf)


class LibreDwgConverter(CadConverter):
    """LibreDWG `dwg2dxf` (open source). Good for common drawings, weaker on newest formats."""

    name = "libredwg"

    def _get_executable(self) -> str | None:
        p = Path(settings.libredwg_dwg2dxf_path)
        if p.exists():
            return str(p)
        if shutil.which(settings.libredwg_dwg2dxf_path):
            return settings.libredwg_dwg2dxf_path
        from app.config import BASE_DIR
        local_tool = BASE_DIR / "tools" / "libredwg" / "dwg2dxf.exe"
        if local_tool.exists():
            return str(local_tool)
        return None

    def available(self) -> bool:
        return self._get_executable() is not None

    def convert(self, dwg: Path, out_dxf: Path, timeout: int) -> None:
        exe = self._get_executable()
        if not exe:
            raise ConversionError("dwg2dxf executable not found.")
        res = _run([exe, "-y", "-o", str(out_dxf), str(dwg)], timeout)
        # dwg2dxf returns non-zero for recoverable warnings; >=128 is critical.
        ok = out_dxf.exists() and out_dxf.stat().st_size > 0 and res.returncode < 128
        if not ok:
            raise ConversionError(f"dwg2dxf failed (rc={res.returncode}): {res.stderr[-500:]}")
        if res.returncode:
            log.warning("dwg2dxf finished with warnings (rc=%s)", res.returncode)


_REGISTRY: dict[str, type[CadConverter]] = {"oda": OdaConverter, "libredwg": LibreDwgConverter}


def configured_converters() -> list[CadConverter]:
    names = [n.strip().lower() for n in settings.converter_order.split(",") if n.strip()]
    return [_REGISTRY[n]() for n in names if n in _REGISTRY]


def available_converters() -> list[CadConverter]:
    return [c for c in configured_converters() if c.available()]


def convert_dwg_to_dxf(dwg: Path, out_dxf: Path, timeout: int | None = None) -> str:
    """Try each available converter in order. Returns the name of the one that worked."""
    timeout = timeout or settings.converter_timeout_seconds
    converters = available_converters()
    if not converters:
        raise ConversionError("No DWG converter is installed (ODA File Converter or LibreDWG).")
    errors: list[str] = []
    for conv in converters:
        try:
            out_dxf.unlink(missing_ok=True)
            conv.convert(dwg, out_dxf, timeout)
            return conv.name
        except (ConversionError, subprocess.TimeoutExpired, OSError) as exc:
            log.error("converter %s failed: %s", conv.name, exc)
            errors.append(f"{conv.name}: {exc}")
    raise ConversionError("; ".join(errors))
