import ezdxf

doc = ezdxf.readfile('backend/temp/aespl_c.dxf')
print('=== Searching for S/S D in modelspace ===')
for e in doc.modelspace():
    if e.dxftype() in ('TEXT', 'MTEXT'):
        t = getattr(e.dxf, 'text', '') or getattr(e, 'text', '')
        if 'S/S' in t or 'S/S D' in t:
            print(f'Text: "{t}" at ({e.dxf.insert.x:.2f}, {e.dxf.insert.y:.2f}) layer={e.dxf.layer} rot={getattr(e.dxf, "rotation", 0)}')
            target_pos = (e.dxf.insert.x, e.dxf.insert.y)
            # Find nearby inserts
            for ins in doc.modelspace().query('INSERT'):
                ix, iy = ins.dxf.insert.x, ins.dxf.insert.y
                if abs(ix - target_pos[0]) <= 50 and abs(iy - target_pos[1]) <= 50:
                    print(f'  Nearby INSERT: {ins.dxf.name} at ({ix:.2f}, {iy:.2f}) rot={getattr(ins.dxf, "rotation", 0)} scale=({ins.dxf.xscale}, {ins.dxf.yscale})')
