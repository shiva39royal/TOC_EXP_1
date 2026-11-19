import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfjsPath = path.resolve(__dirname, '../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = await import(`file://${pdfjsPath}`);

async function extractTable1(filePath, startPage, endPage) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const rows = [];

  for (let p = startPage; p <= Math.min(endPage, doc.numPages); p++) {
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
      rows.push({ page: p, texts, full: texts.join(' | ') });
    }
  }
  return rows;
}

console.log('=== EXTRACTING TABLE 1 FROM Table Of Contro Chitgidda.pdf (Pages 3-6) ===');
const gtRows = await extractTable1(path.resolve(__dirname, '../DATA/ground_truth_tocs/Table Of Contro Chitgidda.pdf'), 3, 6);
gtRows.filter(r => /^S\d/i.test(r.texts[0] || '')).forEach((r, i) => {
  console.log(`GT #${i+1} [P${r.page}]: ${r.full}`);
});

console.log('\n=== EXTRACTING TABLE 1 FROM New ONE.pdf (Pages 1-3) ===');
const genRows = await extractTable1(path.resolve(__dirname, '../DATA/generated_outputs/New ONE.pdf'), 1, 3);
genRows.filter(r => /^\d+$/i.test(r.texts[0] || '')).forEach((r, i) => {
  console.log(`GEN #${i+1} [P${r.page}]: ${r.full}`);
});
