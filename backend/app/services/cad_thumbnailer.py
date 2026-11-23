"""In-Memory CAD Block Rasterization & Feature Extraction Service.

Renders AutoCAD block definitions and entity assemblies into normalized
24x24 (or 20x20) pixel images and extracts perceptual visual signatures.
"""
from __future__ import annotations

import io
import math
from typing import Any
import numpy as np
from PIL import Image
import imagehash
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.config import Configuration
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend


_thumbnail_cache: dict[str, tuple[Image.Image, imagehash.ImageHash, imagehash.ImageHash]] = {}


def render_block_thumbnail(
    doc: Any,
    block_or_entities: Any,
    cache_key: str = "",
    size: tuple[int, int] = (24, 24),
) -> tuple[Image.Image, imagehash.ImageHash, imagehash.ImageHash]:
    """
    Renders CAD block geometry in-memory to a normalized size (default 24x24 px).
    Returns:
        (PIL.Image, phash, dhash)
    """
    if cache_key and cache_key in _thumbnail_cache:
        return _thumbnail_cache[cache_key]

    fig = plt.figure(figsize=(1, 1), dpi=size[0])
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor("black")
    ax.axis("off")

    try:
        ctx = RenderContext(doc)
        out = MatplotlibBackend(ax)
        cfg = Configuration(pdsize=1)
        frontend = Frontend(ctx, out, config=cfg)

        if hasattr(block_or_entities, "query") or hasattr(block_or_entities, "__iter__"):
            frontend.draw_entities(block_or_entities)
        else:
            frontend.draw_entities([block_or_entities])

        ax.autoscale(tight=True)
        # Ensure square aspect ratio
        ax.set_aspect("equal", adjustable="box")

        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=size[0], facecolor="black", edgecolor="none", pad_inches=0)
        buf.seek(0)
        img = Image.open(buf).convert("RGB").resize(size, Image.Resampling.LANCZOS)
    except Exception as e:
        # Fallback to blank 24x24 image on render issue
        img = Image.new("RGB", size, (0, 0, 0))
    finally:
        plt.close(fig)

    ph = imagehash.phash(img)
    dh = imagehash.dhash(img)

    if cache_key:
        _thumbnail_cache[cache_key] = (img, ph, dh)

    return img, ph, dh


def compute_image_signatures(img: Image.Image) -> tuple[imagehash.ImageHash, imagehash.ImageHash]:
    """Computes pHash and dHash for any PIL Image."""
    if img.mode != "RGB":
        img = img.convert("RGB")
    return imagehash.phash(img), imagehash.dhash(img)
