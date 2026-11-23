import sys
import os

sys.path.insert(0, r'C:\Users\shiva\.gemini\antigravity\brain\fd9d29f5-c979-47c0-8737-839604c53e8e\scratch\dwg-layout-viewer\backend')

from app.services.dwg_processor import process_dwg

dwg_path = r'C:\Users\shiva\OneDrive\Desktop\TOC\Code\archive-to-home-13\DATA\layouts\0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg'
res = process_dwg(dwg_path)
print("DWG Process Result:")
print("Success:", res.get("success"))
print("Components found:", len(res.get("components", [])))
print("Categories:", res.get("categories"))

comps = res.get("components", [])
print(f"\nListing first 30 components:")
for c in comps[:30]:
    print(f"[{c.get('category')}] id={c.get('id')} name='{c.get('name')}' layer='{c.get('layer')}' tags={c.get('tags')}")
