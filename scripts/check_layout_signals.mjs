import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check signals in pipeline or run layout analysis on Chitgidda_Layout.pdf
const layoutPath = path.resolve(__dirname, '../DATA/layouts/Chitgidda_Layout.pdf');
console.log('Layout exists:', fs.existsSync(layoutPath));

const pdfjsPath = path.resolve(__dirname, '../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = await import(`file://${pdfjsPath}`);

const data = new Uint8Array(fs.readFileSync(layoutPath));
const doc = await pdfjs.getDocument({ data }).promise;
console.log('Chitgidda_Layout.pdf pages:', doc.numPages);

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const textContent = await page.getTextContent();
  const texts = textContent.items.map(it => it.str.trim()).filter(s => s.length > 0);
  console.log(`Page ${p} has ${texts.length} text items.`);
  const signalLike = texts.filter(t => /^S\s*\d{1,3}/i.test(t));
  console.log(`Signal-like texts:`, signalLike);
}
