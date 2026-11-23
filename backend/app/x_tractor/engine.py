"""Master X-Tractor Engine: Automated RDSO KAVACH Table Synthesis from AutoCAD Drawings."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import ezdxf
import ezdxf.recover

from app.x_tractor.models.kavach_tables import FullKavachExport
from app.x_tractor.parser.title_block_parser import TitleBlockParser
from app.x_tractor.parser.entity_classifier import EntityClassifier
from app.x_tractor.parser.chainage_parser import ChainageParser
from app.x_tractor.topology.track_graph import TrackGraphBuilder
from app.x_tractor.topology.asset_projector import AssetProjector
from app.x_tractor.topology.route_resolver import RouteResolver
from app.x_tractor.generators.toc_generator import TocGenerator
from app.x_tractor.generators.profile_generator import ProfileGenerator
from app.x_tractor.generators.tsr_generator import TsrGenerator
from app.x_tractor.generators.tsl_generator import TslGenerator

log = logging.getLogger("x_tractor.engine")


class XTractorEngine:
    """Enterprise engine to extract railway signaling topology and synthesize RDSO KAVACH tables."""

    @classmethod
    def extract_from_dxf(cls, dxf_path: Path, dwg_path: Path | None = None) -> FullKavachExport:
        log.info("Starting X-Tractor extraction on: %s", dxf_path)

        # 1. Load DXF Document
        try:
            doc = ezdxf.readfile(str(dxf_path))
        except Exception:
            doc, _ = ezdxf.recover.readfile(str(dxf_path))

        # Enhance with raw DWG attributes if available
        if dwg_path and dwg_path.is_file():
            try:
                from app.services.dxf_enhancer import enhance_doc_from_dwg
                enhance_doc_from_dwg(doc, dwg_path)
            except Exception as e:
                log.warning("DWG attribute enhancement skipped: %s", e)

        # 2. Parse Title Block & Station Metadata (Zero hardcoding)
        station_meta = TitleBlockParser.parse(doc, file_name=dxf_path.name)

        # 3. Classify Domain Entities
        entities = EntityClassifier.extract_all(doc, dwg_path=dwg_path)
        signals = entities["signals"]
        points = entities["points"]
        tins = entities["tins"]
        rfid_tags = entities["rfid_tags"]
        lc_gates = entities["lc_gates"]
        ohe_poles = entities["ohe_poles"]
        track_conditions = entities["track_conditions"]
        declared_routes = entities.get("declared_routes", [])

        # 4. Build Track Graph & Track Bands
        G, bands = TrackGraphBuilder.build(doc)

        # 5. Project Assets onto Track Centerlines
        projector = AssetProjector(bands)
        projector.assign_to_assets(signals)
        projector.assign_to_assets(points)
        projector.assign_to_assets(rfid_tags)
        projector.assign_to_assets(tins)
        projector.assign_to_assets(lc_gates)
        projector.assign_to_assets(ohe_poles)

        # 6. Dynamically Resolve Operational Routes
        routes = RouteResolver.resolve_routes(signals, points, tins, rfid_tags, bands, declared_routes=declared_routes)

        # 7. Synthesize KAVACH Tables
        # A. Table of Control, Block Section Details, Shunting Limits
        toc_rows, block_sec_rows, shunting_rows = TocGenerator.generate(
            routes=routes,
            station_meta=station_meta,
            signals=signals,
            rfid_tags=rfid_tags,
            tins=tins
        )

        # B. Track Profile Table
        track_profile_rows = ProfileGenerator.generate(
            routes=routes,
            lc_gates=lc_gates,
            track_conditions=track_conditions,
            engineering_gradients=[]
        )

        # C. TSR Route Table & OHE Masts
        tsr_rows = TsrGenerator.generate(
            routes=routes,
            station_meta=station_meta,
            ohe_poles=ohe_poles
        )

        # D. TSL Working Table
        tsl_rows = TslGenerator.generate(
            routes=routes,
            station_meta=station_meta
        )

        summary = {
            "stationName": station_meta.station_name,
            "stationId": station_meta.station_id,
            "totalSignals": len(signals),
            "totalPoints": len(points),
            "totalTins": len(tins),
            "totalRfidTags": len(rfid_tags),
            "totalLcGates": len(lc_gates),
            "totalOhePoles": len(ohe_poles),
            "totalRoutes": len(routes),
            "totalTocRows": len(toc_rows),
            "totalTrackProfileRows": len(track_profile_rows),
            "totalTsrRows": len(tsr_rows),
            "totalTslRows": len(tsl_rows),
            "isXTractor": True
        }

        log.info("X-Tractor completed successfully: %s", summary)

        return FullKavachExport(
            station_meta=station_meta,
            table_of_control=toc_rows,
            block_section_details=block_sec_rows,
            shunting_limits=shunting_rows,
            track_profiles=track_profile_rows,
            tsr_routes=tsr_rows,
            tsl_routes=tsl_rows,
            summary=summary
        )
