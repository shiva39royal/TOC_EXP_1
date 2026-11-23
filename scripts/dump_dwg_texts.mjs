import fs from 'fs';
import path from 'path';

const wasmDir = path.resolve('frontend/node_modules/@mlightcad/libredwg-web/wasm');
const { LibreDwg } = await import('../frontend/node_modules/@mlightcad/libredwg-web/lib/index.js');
const DxfParser = (await import('../frontend/node_modules/dxf-parser/dist/dxf-parser.js')).default;

const libredwg = await LibreDwg.create(wasmDir);
const dwgBuf = fs.readFileSync('DATA/layouts/0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg');
const ab = dwgBuf.buffer.slice(dwgBuf.byteOffset, dwgBuf.byteOffset + dwgBuf.byteLength);

const dxfBytes = libredwg.dwg_write_dxf(ab);
const dxfText = new TextDecoder('utf-8').decode(dxfBytes);
const parser = new DxfParser();
const dxfData = parser.parseSync(dxfText);

const allTexts = [];
for (const e of dxfData.entities) {
  if (e.text) {
    allTexts.push({
      src: 'ENTITY',
      layer: e.layer,
      text: e.text,
      x: e.position?.x ?? e.startPoint?.x ?? 0,
      y: e.position?.y ?? e.startPoint?.y ?? 0,
    });
  }
}

for (const [bName, blk] of Object.entries(dxfData.blocks || {})) {
  for (const be of (blk.entities || [])) {
    if (be.text) {
      allTexts.push({
        src: `BLOCK ${bName}`,
        layer: be.layer,
        text: be.text,
        x: be.position?.x ?? be.startPoint?.x ?? 0,
        y: be.position?.y ?? be.startPoint?.y ?? 0,
      });
    }
  }
}

console.log('Total texts found:', allTexts.length);
allTexts.sort((a, b) => a.x - b.x);
for (const t of allTexts) {
  console.log(`[${t.src} / ${t.layer}] (x=${Math.round(t.x)}, y=${Math.round(t.y)}): "${t.text}"`);
}
