import fs from 'fs';
import path from 'path';
import { parseCadFileBuffer } from '../frontend/src/utils/cadParser';

const dwgBuf = fs.readFileSync('DATA/layouts/0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg');
const parsed = await parseCadFileBuffer(new Uint8Array(dwgBuf), '0_RFIDtag_TIN_Layout_Model_Stations_AESPL_C.dwg', 'DWG');

console.log('Parsed summary length:', parsed.summary.length);
console.log('Layout tokens count:', parsed.layoutTokens.length);

const kinds: Record<string, number> = {};
for (const t of parsed.layoutTokens) {
  const k = (t.kind as string) || 'text';
  kinds[k] = (kinds[k] || 0) + 1;
}
console.log('Token kinds:', kinds);

const textTokens = parsed.layoutTokens.filter(t => !t.kind || t.kind === 'text');
console.log('Text tokens count:', textTokens.length);
console.log('Sample text tokens (first 50):');
for (const t of textTokens.slice(0, 50)) {
  console.log(`  "${t.text}" at (${Math.round(t.x as number)}, ${Math.round(t.y as number)})`);
}
