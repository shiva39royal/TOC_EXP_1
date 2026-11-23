"""DWG processing facade.

The API layer only depends on `DWGProcessor`. The default implementation chains
a DWG->DXF converter and the ezdxf render engine; a different engine (e.g. an
ODA SDK renderer or a hosted service) can be dropped in by subclassing.
"""
from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Callable

from app.services import cad_converter, render_service

log = logging.getLogger("cad.processor")

# update(status, progress 0-100, human readable stage)
Update = Callable[[str, int, str], None]


class DWGProcessor(ABC):
    @abstractmethod
    def process(self, file_path: Path, work_dir: Path, update: Update) -> dict:
        """Produces work_dir/render/manifest.json (+ layout files). Returns the manifest."""


class ConverterDWGProcessor(DWGProcessor):
    def process(self, file_path: Path, work_dir: Path, update: Update) -> dict:
        processed = work_dir / "processed"
        render_dir = work_dir / "render"
        processed.mkdir(exist_ok=True)
        dxf = processed / "drawing.dxf"

        update("converting", 8, "Processing CAD drawing")
        converter = cad_converter.convert_dwg_to_dxf(file_path, dxf)
        log.info("converted with %s (%.1f MB DXF)", converter, dxf.stat().st_size / 1e6)

        def on_render(pct: int, label: str) -> None:
            if label.startswith("Reading"):
                update("preparing", 35, "Preparing layout")
            else:
                update("rendering", 40 + int(pct * 0.58), "Rendering")

        manifest = render_service.build_render_set(dxf, render_dir, on_render, dwg_path=file_path)
        manifest["converter"] = converter
        (render_dir / "manifest.json").write_text(json.dumps(manifest))
        return manifest


def get_processor() -> DWGProcessor:
    return ConverterDWGProcessor()
