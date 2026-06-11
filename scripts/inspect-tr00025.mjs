import XLSX from 'xlsx';
import fs from 'fs';

const file = 'attached_assets/TR00025 Commercial Invoice.xlsx';
const buf = fs.readFileSync(file);
const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true });

console.log('Sheets:', JSON.stringify(wb.SheetNames));

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  console.log('\n==== Sheet:', sheetName, '| ref:', ws['!ref'], '====');

  console.log('\n-- Merged cells:');
  (ws['!merges'] || []).forEach((m) => {
    console.log('  ', XLSX.utils.encode_range(m));
  });

  console.log('\n-- Column widths:');
  (ws['!cols'] || []).forEach((c, i) => {
    if (c) console.log(`   col ${XLSX.utils.encode_col(i)}: wch=${c.wch ?? c.width ?? '?'}`);
  });

  console.log('\n-- Row heights (non-default):');
  (ws['!rows'] || []).forEach((r, i) => {
    if (r && r.hpt) console.log(`   row ${i + 1}: hpt=${r.hpt}`);
  });

  console.log('\n-- All non-empty cells (addr | type | value | formula):');
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    const parts = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell || (cell.v === undefined && !cell.f)) continue;
      let s = `${addr}=${JSON.stringify(cell.v)}`;
      if (cell.f) s += ` [f: ${cell.f}]`;
      if (cell.z && cell.z !== 'General') s += ` {z: ${cell.z}}`;
      parts.push(s);
    }
    if (parts.length) console.log(`  R${R + 1}: ${parts.join(' | ')}`);
  }
}
