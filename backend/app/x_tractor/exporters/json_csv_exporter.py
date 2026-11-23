"""JSON and RFC 4180 CSV exporter for RDSO KAVACH tables."""
from __future__ import annotations

import csv
import io
import json
from typing import Any

from app.x_tractor.models.kavach_tables import FullKavachExport


class JsonCsvExporter:
    """Exports KAVACH tables as CSV strings and JSON dictionaries."""

    @classmethod
    def to_dict(cls, data: FullKavachExport) -> dict[str, Any]:
        return data.model_dump()

    @classmethod
    def to_json(cls, data: FullKavachExport) -> str:
        return json.dumps(cls.to_dict(data), indent=2)

    @classmethod
    def export_csv(cls, rows: list[Any]) -> str:
        if not rows:
            return ""
        out = io.StringIO()
        first = rows[0]
        fields = list(first.__dict__.keys()) if hasattr(first, "__dict__") else list(first.keys())
        writer = csv.DictWriter(out, fieldnames=fields)
        writer.writeheader()
        for r in rows:
            d = r.model_dump() if hasattr(r, "model_dump") else (r.__dict__ if hasattr(r, "__dict__") else r)
            writer.writerow(d)
        return out.getvalue()
