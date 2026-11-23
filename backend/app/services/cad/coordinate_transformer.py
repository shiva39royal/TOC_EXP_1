"""Authoritative CAD Coordinate Transformation and Block Traversal Service.

Uses ezdxf.math.Matrix44 to rigorously handle:
- Nested block transformations
- 2D/3D Translation, Rotation, and Scaling
- Non-uniform scaling and negative scaling (mirroring)
- Exact bounding box transformations (corner projection)
- Recursive block traversal with recursion-stack cycle detection
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import ezdxf
from ezdxf.math import Matrix44, Vec3


@dataclass
class BlockHierarchyResult:
    canonical_name: str
    raw_name: str
    ancestry: list[str]
    world_matrix: Matrix44
    attributes: dict[str, str]
    source_handle: str
    has_anonymous_parent: bool = False
    inner_entities_count: int = 0


class CoordinateTransformer:
    """Mathematical transformation engine for AutoCAD entities and blocks."""

    @staticmethod
    def get_insert_matrix(entity: Any) -> Matrix44:
        """Constructs an ezdxf Matrix44 for an INSERT entity.
        
        Applies transformations in canonical CAD order:
        1. Scale (x, y, z)
        2. Rotation (degrees around Z-axis)
        3. Translation (insert x, y, z)
        """
        if getattr(entity, "dxftype", lambda: "")() != "INSERT":
            return Matrix44()

        ins = getattr(entity.dxf, "insert", (0.0, 0.0, 0.0))
        ins_x = float(ins[0])
        ins_y = float(ins[1])
        ins_z = float(ins[2]) if len(ins) > 2 else 0.0

        xs = float(getattr(entity.dxf, "xscale", 1.0))
        ys = float(getattr(entity.dxf, "yscale", 1.0))
        zs = float(getattr(entity.dxf, "zscale", 1.0))

        rot_deg = float(getattr(entity.dxf, "rotation", 0.0))
        rot_rad = math.radians(rot_deg)

        m = Matrix44.scale(xs, ys, zs) @ Matrix44.z_rotate(rot_rad) @ Matrix44.translate(ins_x, ins_y, ins_z)
        return m

    @staticmethod
    def compose(parent_matrix: Matrix44 | None, local_matrix: Matrix44) -> Matrix44:
        """Composes parent and local matrices: p_world = parent_matrix(local_matrix(p_local))."""
        if parent_matrix is None:
            return local_matrix
        return local_matrix @ parent_matrix

    @staticmethod
    def transform_pt(matrix: Matrix44, pt: tuple[float, float] | list[float]) -> list[float]:
        """Transforms a 2D point (x, y) through the 4x4 matrix and returns [x_world, y_world]."""
        x = float(pt[0])
        y = float(pt[1])
        v = matrix.transform(Vec3(x, y, 0.0))
        return [round(float(v.x), 4), round(float(v.y), 4)]

    @staticmethod
    def transform_bbox(matrix: Matrix44, bbox_local: tuple[float, float, float, float] | list[float]) -> list[float]:
        """Transforms a 2D bounding box (min_x, min_y, max_x, max_y) through the matrix
        by projecting all 4 local corners into world space and computing their envelope.
        """
        min_x, min_y, max_x, max_y = bbox_local
        corners = [
            Vec3(min_x, min_y, 0.0),
            Vec3(max_x, min_y, 0.0),
            Vec3(max_x, max_y, 0.0),
            Vec3(min_x, max_y, 0.0),
        ]
        world_pts = [matrix.transform(c) for c in corners]
        wx = [float(p.x) for p in world_pts]
        wy = [float(p.y) for p in world_pts]
        return [
            round(min(wx), 4),
            round(min(wy), 4),
            round(max(wx), 4),
            round(max(wy), 4),
        ]

    @staticmethod
    def matrix_to_list(matrix: Matrix44) -> list[float]:
        """Serializes 4x4 matrix to flattened 16-element float list."""
        out: list[float] = []
        for row in matrix.matrix:
            out.extend([round(float(val), 6) for val in row])
        return out

    @staticmethod
    def decompose(matrix: Matrix44) -> dict[str, Any]:
        """Decomposes affine matrix into translation, rotation (deg), and scale (x, y)."""
        origin = matrix.transform(Vec3(0, 0, 0))
        unit_x = matrix.transform(Vec3(1, 0, 0)) - origin
        unit_y = matrix.transform(Vec3(0, 1, 0)) - origin

        sx = float(unit_x.magnitude)
        sy = float(unit_y.magnitude)
        rot_deg = math.degrees(math.atan2(unit_x.y, unit_x.x)) % 360.0

        # Detect negative determinant / mirroring
        det = unit_x.x * unit_y.y - unit_x.y * unit_y.x
        if det < 0:
            sy = -sy

        return {
            "translation": [round(float(origin.x), 4), round(float(origin.y), 4)],
            "rotation_deg": round(rot_deg, 2),
            "scale": [round(sx, 4), round(sy, 4)],
            "is_mirrored": det < 0,
        }

    @classmethod
    def resolve_block_hierarchy(
        cls,
        entity: Any,
        doc: Any,
        parent_matrix: Matrix44 | None = None,
        max_depth: int = 32,
    ) -> BlockHierarchyResult:
        """Recursively resolves an INSERT entity, unwrapping anonymous *U blocks,
        accumulating 4x4 affine transformations, attributes, and block ancestry.
        
        Uses stack-based cycle detection to safely permit repeated block references
        without risking infinite recursion.
        """
        handle = getattr(getattr(entity, "dxf", None), "handle", "")
        raw_name = getattr(getattr(entity, "dxf", None), "name", "")
        local_m = cls.get_insert_matrix(entity)
        world_m = cls.compose(parent_matrix, local_m)

        # Collect initial attributes on this INSERT
        attributes: dict[str, str] = {}
        for a in getattr(entity, "attribs", []):
            tag = getattr(getattr(a, "dxf", None), "tag", "")
            val = getattr(getattr(a, "dxf", None), "text", "")
            if tag:
                attributes[tag.strip()] = val.strip()

        if not doc or not hasattr(doc, "blocks") or not raw_name:
            return BlockHierarchyResult(
                canonical_name=raw_name,
                raw_name=raw_name,
                ancestry=[raw_name],
                world_matrix=world_m,
                attributes=attributes,
                source_handle=handle,
            )

        active_stack: list[str] = [raw_name]
        canonical_name = raw_name
        has_anonymous = raw_name.startswith("*U")

        def _traverse(cur_bname: str, cur_m: Matrix44, depth: int) -> tuple[str, Matrix44]:
            nonlocal has_anonymous
            if depth >= max_depth:
                return cur_bname, cur_m

            blk = doc.blocks.get(cur_bname)
            if not blk:
                return cur_bname, cur_m

            # Collect ATTDEF defaults if not yet present
            for be in blk:
                if be.dxftype() == "ATTDEF":
                    tag = getattr(getattr(be, "dxf", None), "tag", "")
                    val = getattr(getattr(be, "dxf", None), "text", "")
                    if tag and tag.strip() not in attributes:
                        attributes[tag.strip()] = val.strip()

            # Query inner INSERTs
            best_child_name = cur_bname
            best_child_m = cur_m

            for inner_ins in blk.query("INSERT"):
                child_name = getattr(inner_ins.dxf, "name", "")
                if not child_name or child_name in active_stack:
                    # Cycle detected in current branch, skip
                    continue

                child_local_m = cls.get_insert_matrix(inner_ins)
                child_world_m = cls.compose(cur_m, child_local_m)

                # Collect child attributes
                for a in getattr(inner_ins, "attribs", []):
                    tag = getattr(getattr(a, "dxf", None), "tag", "")
                    val = getattr(getattr(a, "dxf", None), "text", "")
                    if tag:
                        attributes[tag.strip()] = val.strip()

                active_stack.append(child_name)
                if not child_name.startswith("*U"):
                    best_child_name = child_name
                    best_child_m = child_world_m
                else:
                    has_anonymous = True
                    rec_name, rec_m = _traverse(child_name, child_world_m, depth + 1)
                    if not rec_name.startswith("*U"):
                        best_child_name = rec_name
                        best_child_m = rec_m

                active_stack.pop()
                if not best_child_name.startswith("*U"):
                    break

            return best_child_name, best_child_m

        if raw_name.startswith("*U"):
            canonical_name, world_m = _traverse(raw_name, world_m, 1)

        # Collect ATTDEFs from canonical block definition if not overridden
        if canonical_name and doc and hasattr(doc, "blocks"):
            target_blk = doc.blocks.get(canonical_name)
            if target_blk:
                for be in target_blk:
                    if be.dxftype() == "ATTDEF":
                        tag = getattr(getattr(be, "dxf", None), "tag", "")
                        val = getattr(getattr(be, "dxf", None), "text", "")
                        if tag and tag.strip() not in attributes:
                            attributes[tag.strip()] = val.strip()

        return BlockHierarchyResult(
            canonical_name=canonical_name,
            raw_name=raw_name,
            ancestry=list(active_stack),
            world_matrix=world_m,
            attributes=attributes,
            source_handle=handle,
            has_anonymous_parent=has_anonymous,
        )
