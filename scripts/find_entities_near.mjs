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

// Find all entities within X in [7200, 7500]
console.log('=== Entities around x=7200..7500 ===');
for (const e of dxfData.entities) {
  const x = e.position?.x ?? e.startPoint?.x ?? (e.vertices ? e.vertices[0]?.x : null);
  const y = e.position?.y ?? e.startPoint?.y ?? (e.vertices ? e.vertices[0]?.y : null);
  if (x !== null && x >= 7200 && x <= 7500) {
    console.log(`Layer: "${e.layer}", Type: ${e.type}, Name: "${e.name || ''}", Text: "${e.text || ''}", Pos: (${Math.round(x)}, ${Math.round(y)})`);
  }
}
