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

const layerCounts = {};
for (const ent of dxfData.entities || []) {
  const l = ent.layer || '0';
  if (!layerCounts[l]) layerCounts[l] = { total: 0, types: {} };
  layerCounts[l].total++;
  layerCounts[l].types[ent.type] = (layerCounts[l].types[ent.type] || 0) + 1;
}

console.log('Modelspace Layers:');
for (const [l, data] of Object.entries(layerCounts)) {
  console.log(`  ${l}: ${data.total} entities -> `, JSON.stringify(data.types));
}

console.log('\n--- BLOCKS SUMMARY ---');
for (const [bName, bDef] of Object.entries(dxfData.blocks || {})) {
  const ents = bDef.entities || [];
  const atts = ents.filter(e => e.type === 'ATTDEF' || e.type === 'ATTRIB').map(a => `${a.tag}=${a.text || a.value || ''}`);
  if (atts.length > 0 || !bName.startsWith('*')) {
    console.log(`Block ${bName}: count=${ents.length}, attributes=[${atts.join(', ')}]`);
  }
}
