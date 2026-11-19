import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfjsPath = path.resolve(__dirname, '../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = await import(`file://${pdfjsPath}`);

async function dumpGeneratedTable(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const rows = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map(it => ({ str: it.str.trim(), x: Math.round(it.transform[4]), y: Math.round(it.transform[5]) }))
      .filter(it => it.str.length > 0);

    const rowMap = new Map();
    for (const item of items) {
      let matchedY = null;
      for (const y of rowMap.keys()) {
        if (Math.abs(y - item.y) <= 4) {
          matchedY = y;
          break;
        }
      }
      if (matchedY !== null) {
        rowMap.get(matchedY).push(item);
      } else {
        rowMap.set(item.y, [item]);
      }
    }

    const sorted = Array.from(rowMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, r]) => r.sort((a, b) => a.x - b.x));

    for (const r of sorted) {
      const texts = r.map(it => it.str);
      // If starts with a number (S.No)
      if (/^\d+$/.test(texts[0] || '')) {
        rows.push({
          page: p,
          slNo: texts[0],
          entrySig: texts[1] || '',
          exitSig: texts[2] || '',
          line: texts[3] || '',
          tsrmsId: texts[4] || '',
          secType: texts[5] || '',
          sigType: texts[6] || '',
          entryAspect: texts[7] || '',
          exitAspect: texts[8] || '',
          all: texts,
        });
      }
    }
  }
  return rows;
}

const genRows = await dumpGeneratedTable(path.resolve(__dirname, '../DATA/generated_outputs/New ONE.pdf'));
console.log(`Extracted ${genRows.length} rows from New ONE.pdf:\n`);
console.log(
  '#'.padEnd(4) +
  'Entry'.padEnd(10) +
  'Exit'.padEnd(18) +
  'Line'.padEnd(10) +
  'TSRMS ID'.padEnd(12) +
  'Signal Type'.padEnd(30) +
  'Entry Aspect'.padEnd(25) +
  'Requires Exit Aspect'
);
console.log('-'.repeat(130));

genRows.forEach(r => {
  console.log(
    r.slNo.padEnd(4) +
    r.entrySig.padEnd(10) +
    r.exitSig.padEnd(18) +
    r.line.padEnd(10) +
    r.tsrmsId.padEnd(12) +
    r.sigType.slice(0, 28).padEnd(30) +
    r.entryAspect.slice(0, 23).padEnd(25) +
    r.exitAspect
  );
});
