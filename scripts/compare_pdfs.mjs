import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfjsPath = path.resolve(__dirname, '../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = await import(`file://${pdfjsPath}`);

async function inspectPdf(filePath) {
  console.log(`\n=======================================================`);
  console.log(`INSPECTING: ${filePath}`);
  console.log(`=======================================================`);
  if (!fs.existsSync(filePath)) {
    console.log(`FILE NOT FOUND: ${filePath}`);
    return;
  }
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data }).promise;
  console.log(`Total Pages: ${doc.numPages}`);

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .map(it => ({
        str: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
      }))
      .filter(it => it.str.length > 0);

    // Group items into horizontal rows based on Y coordinate (within 4 points)
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

    const sortedRows = Array.from(rowMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map(it => it.str).join(' | '));

    console.log(`--- Page ${pageNum} (${sortedRows.length} rows) ---`);
    for (const row of sortedRows) {
      // Print rows that have route-like content
      if (/S\d|Route|Signal|Aspect|Line|Table/i.test(row)) {
        console.log(row);
      }
    }
  }
}

await inspectPdf(path.resolve(__dirname, '../DATA/generated_outputs/New ONE.pdf'));
await inspectPdf(path.resolve(__dirname, '../DATA/ground_truth_tocs/Table Of Contro Chitgidda.pdf'));
