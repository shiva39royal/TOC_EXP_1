"""CAD Conversion Fidelity Verifier and Extraction Diagnostics Engine.

Inspects DXF drawings to measure entity preservation, block definitions,
layer integrity, and extent validity, generating structured diagnostics.
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import bbox

log = logging.getLogger("cad.verifier")

CRITICAL_ENTITY_TYPES = {
    "LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC",
    "INSERT", "TEXT", "MTEXT", "HATCH", "DIMENSION"
}


@dataclass
class ConversionFidelityReport:
    is_valid: bool
    dxf_version: str
    total_entities: int
    entity_counts: dict[str, int]
    total_layers: int
    layers: list[str]
    total_blocks: int
    anonymous_blocks_count: int
    standard_blocks_count: int
    drawing_extents: dict[str, float]
    warnings: list[str]
    is_empty_or_corrupt: bool = False


class CadConversionVerifier:
    """Verifies conversion completeness and structural integrity of converted DXF drawings."""

    @classmethod
    def verify_document(cls, doc: Any, file_name: str = "") -> ConversionFidelityReport:
        """Analyzes an ezdxf Drawing object and computes entity counts, extents, and warnings."""
        warnings: list[str] = []
        entity_counts: dict[str, int] = {}
        total_entities = 0

        # 1. Tally Modelspace Entities
        try:
            msp = doc.modelspace()
            for entity in msp:
                dxftype = entity.dxftype()
                entity_counts[dxftype] = entity_counts.get(dxftype, 0) + 1
                total_entities += 1
        except Exception as exc:
            warnings.append(f"Failed to query modelspace: {exc}")
            msp = None

        # 2. Inspect Layers
        layers: list[str] = []
        try:
            for layer in doc.layers:
                layers.append(layer.dxf.name)
        except Exception as exc:
            warnings.append(f"Failed to inspect layers: {exc}")

        # 3. Inspect Block Definitions
        total_blocks = 0
        anon_blocks = 0
        standard_blocks = 0
        try:
            for blk in doc.blocks:
                total_blocks += 1
                if blk.name.startswith("*"):
                    anon_blocks += 1
                else:
                    standard_blocks += 1
        except Exception as exc:
            warnings.append(f"Failed to inspect block table: {exc}")

        # 4. Measure Extents
        extents_dict = {"min_x": 0.0, "min_y": 0.0, "max_x": 0.0, "max_y": 0.0}
        try:
            if msp:
                ext = bbox.extents(msp, fast=True)
                if ext.has_data:
                    extents_dict = {
                        "min_x": round(float(ext.extmin.x), 2),
                        "min_y": round(float(ext.extmin.y), 2),
                        "max_x": round(float(ext.extmax.x), 2),
                        "max_y": round(float(ext.extmax.y), 2),
                    }
        except Exception as exc:
            warnings.append(f"Failed to compute extents: {exc}")

        # 5. Sanity Checks & Warning Generation
        if total_entities == 0:
            warnings.append("Drawing contains 0 modelspace entities.")
        if "INSERT" not in entity_counts and standard_blocks > 0:
            warnings.append("Drawing has block definitions but 0 INSERT block references in modelspace.")
        if "LINE" not in entity_counts and "LWPOLYLINE" not in entity_counts:
            warnings.append("Drawing contains neither LINE nor LWPOLYLINE geometry (track detection may be impaired).")

        dxf_ver = getattr(getattr(doc, "header", None), "get", lambda *_: "UNKNOWN")("$ACADVER", "UNKNOWN")
        is_empty = total_entities == 0

        return ConversionFidelityReport(
            is_valid=not is_empty and len(warnings) < 3,
            dxf_version=str(dxf_ver),
            total_entities=total_entities,
            entity_counts=entity_counts,
            total_layers=len(layers),
            layers=layers,
            total_blocks=total_blocks,
            anonymous_blocks_count=anon_blocks,
            standard_blocks_count=standard_blocks,
            drawing_extents=extents_dict,
            warnings=warnings,
            is_empty_or_corrupt=is_empty,
        )

    @classmethod
    def verify_file(cls, dxf_path: Path) -> ConversionFidelityReport:
        """Loads and verifies a DXF file from disk."""
        if not dxf_path.is_file() or dxf_path.stat().st_size == 0:
            return ConversionFidelityReport(
                is_valid=False,
                dxf_version="NONE",
                total_entities=0,
                entity_counts={},
                total_layers=0,
                layers=[],
                total_blocks=0,
                anonymous_blocks_count=0,
                standard_blocks_count=0,
                drawing_extents={"min_x": 0.0, "min_y": 0.0, "max_x": 0.0, "max_y": 0.0},
                warnings=["File does not exist or is 0 bytes."],
                is_empty_or_corrupt=True,
            )

        try:
            doc = ezdxf.readfile(str(dxf_path))
            return cls.verify_document(doc, dxf_path.name)
        except Exception as exc:
            return ConversionFidelityReport(
                is_valid=False,
                dxf_version="ERROR",
                total_entities=0,
                entity_counts={},
                total_layers=0,
                layers=[],
                total_blocks=0,
                anonymous_blocks_count=0,
                standard_blocks_count=0,
                drawing_extents={"min_x": 0.0, "min_y": 0.0, "max_x": 0.0, "max_y": 0.0},
                warnings=[f"Failed to parse DXF: {exc}"],
                is_empty_or_corrupt=True,
            )

