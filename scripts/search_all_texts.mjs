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
function collect(entities, source) {
  for (const e of entities || []) {
    if (e.text) allTexts.push({ text: e.text, layer: e.layer, source });
    if (e.attribs) {
      for (const a of e.attribs) {
        allTexts.push({ text: (a.tag ? a.tag + ':' : '') + (a.text || a.value), layer: e.layer, source: source + ' ATTRIB' });
      }
    }
  }
}

collect(dxfData.entities, 'MODEL');
for (const [bName, b] of Object.entries(dxfData.blocks || {})) {
  collect(b.entities, 'BLOCK ' + bName);
}

console.log('Total texts collected across drawing:', allTexts.length);

// Group by layer
const byLayer = {};
for (const t of allTexts) {
  const l = t.layer || 'unknown';
  byLayer[l] = (byLayer[l] || 0) + 1;
}
console.log('Texts by layer:', byLayer);

// Filter texts that might be tags or signals
const tagLike = allTexts.filter(t => /R[-\s]?\d+|TIN|TAG/i.test(t.text));
console.log('Tag-like texts count:', tagLike.length);
console.log('Sample tag-like texts:', tagLike.slice(0, 30));

const sigLike = allTexts.filter(t => /^(S|SH|C|A)?\d+[A-Z]?$|SIGNAL|HOME|STARTER/i.test(t.text));
console.log('Signal-like texts count:', sigLike.length);
console.log('Sample signal-like texts:', sigLike.slice(0, 30));

// Let's print non-empty unique clean texts
const unique = new Set(allTexts.map(t => t.text.trim()).filter(Boolean));
console.log('Unique text strings count:', unique.size);

// Print all unique texts that look interesting
const interesting = Array.from(unique).filter(t => !/RECA|INNOVATE|LOGO|REVISION|WE INNOVATE/i.test(t));
console.log('Sample interesting texts (first 100):');
console.log(interesting.slice(0, 100));
