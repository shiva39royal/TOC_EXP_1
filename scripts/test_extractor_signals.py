import ezdxf
from pathlib import Path
import sys
sys.path.insert(0, 'backend')
import app.services.component_extractor as ce

doc = ezdxf.readfile('DATA/temp_debug.dxf')
res = ce.extract_components(doc, Path('DATA/layouts/0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg'))
for c in res['components']:
    if c['category'] == 'signals':
        print(f"{c['name']} | layer={c['layer']} | anchor={c['anchor']} | tags={c.get('tags')}")
