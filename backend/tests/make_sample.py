"""Generates a feature-rich DXF (blocks, hatches, dims, text, linetypes, layouts) for tests."""
import ezdxf
from ezdxf.enums import TextEntityAlignment


def make(path: str) -> None:
    doc = ezdxf.new("R2018", setup=True)
    doc.layers.add("TRACKS", color=3, linetype="DASHED")
    doc.layers.add("TEXT", color=2)
    msp = doc.modelspace()
    msp.add_line((0, 0), (1000, 0), dxfattribs={"layer": "TRACKS"})
    msp.add_lwpolyline([(0, 100), (300, 100), (400, 200), (1000, 200)], dxfattribs={"color": 5})
    msp.add_circle((500, 500), 80, dxfattribs={"color": 1})
    msp.add_arc((500, 500), 150, 20, 200, dxfattribs={"color": 4, "lineweight": 50})
    msp.add_spline([(0, 300), (200, 400), (400, 250), (600, 380)])
    blk = doc.blocks.new("SIGNAL")
    blk.add_circle((0, 0), 10, dxfattribs={"color": 0})
    blk.add_line((0, 0), (40, 0), dxfattribs={"color": 0})
    blk.add_text("S1", height=8, dxfattribs={"insert": (12, 12)})
    for i in range(5):
        msp.add_blockref("SIGNAL", (100 + i * 150, 600), dxfattribs={"color": 3, "rotation": 15 * i})
    hatch = msp.add_hatch(color=6)
    hatch.paths.add_polyline_path([(700, 600), (900, 600), (900, 800), (700, 800)])
    h2 = msp.add_hatch(color=2)
    h2.set_pattern_fill("ANSI31", scale=5)
    h2.paths.add_polyline_path([(100, 700), (300, 700), (300, 850), (100, 850)])
    msp.add_text("STATION LAYOUT", height=40, dxfattribs={"layer": "TEXT"}).set_placement(
        (100, 950), align=TextEntityAlignment.LEFT)
    msp.add_mtext("Platform 1\\PPlatform 2", dxfattribs={"insert": (600, 950), "char_height": 20})
    msp.add_linear_dim(base=(0, -120), p1=(0, 0), p2=(1000, 0)).render()
    msp.add_lwpolyline([(-50, -200), (1100, -200), (1100, 1050), (-50, 1050)], close=True)
    paper = doc.layouts.new("Sheet A")
    paper.add_lwpolyline([(10, 10), (400, 10), (400, 280), (10, 280)], close=True)
    paper.add_text("TITLE BLOCK", height=8, dxfattribs={"insert": (20, 20)})
    doc.layouts.new("Empty")
    doc.saveas(path)


if __name__ == "__main__":
    import sys
    make(sys.argv[1])
