import glob
import ezdxf

for p in glob.glob('backend/temp/*.dxf'):
    try:
        doc = ezdxf.readfile(p)
        print(f'=== File: {p} ===')
        for e in doc.modelspace():
            if e.dxftype() in ('TEXT', 'MTEXT'):
                t = getattr(e.dxf, 'text', '') or getattr(e, 'text', '')
                if 's/s' in t.lower() or 'ssd' in t.lower().replace(' ', '').replace('/', ''):
                    print(f'  Text: "{t}" at ({e.dxf.insert.x:.2f}, {e.dxf.insert.y:.2f})')
            elif e.dxftype() == 'INSERT':
                b = doc.blocks.get(e.dxf.name)
                if b:
                    for be in b:
                        if be.dxftype() in ('TEXT', 'MTEXT', 'ATTDEF'):
                            t = getattr(be.dxf, 'text', '') or getattr(be, 'text', '')
                            if 's/s' in t.lower():
                                print(f'  Block {e.dxf.name} text: "{t}" at ({e.dxf.insert.x:.2f}, {e.dxf.insert.y:.2f})')
    except Exception as ex:
        print(f'{p}: {ex}')
