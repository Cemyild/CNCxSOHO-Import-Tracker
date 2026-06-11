import XLSX from 'xlsx';
import fs from 'fs';

const files = [
  'attached_assets/TR00025 Commercial Invoice.xlsx',
  'attached_assets/TR00026 CI PL.xlsx',
];

for (const file of files) {
  console.log('\n########', file, '########');
  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['Invoice'];
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Find the header row (B col = "Style No.") and the Grand Total row
  let headerRow = -1;
  let totalRow = -1;
  for (let R = 0; R <= range.e.r; R++) {
    const b = ws[XLSX.utils.encode_cell({ r: R, c: 1 })];
    if (b && typeof b.v === 'string') {
      if (b.v.startsWith('Style No')) headerRow = R;
      if (b.v.startsWith('Grand Total')) totalRow = R;
    }
  }
  console.log('Header row:', headerRow + 1, '| Grand Total row:', totalRow + 1, '| item rows:', totalRow - headerRow - 1);

  // Dump every cell of header + item rows + total row, full values
  for (let R = headerRow; R <= totalRow; R++) {
    console.log(`\n--- Row ${R + 1} ---`);
    for (let C = 1; C <= 10; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell || (cell.v === undefined && !cell.f)) continue;
      console.log(`  ${addr} [type=${cell.t}]${cell.f ? ' [f: ' + cell.f + ']' : ''}${cell.z && cell.z !== 'General' ? ' {z: ' + cell.z + '}' : ''}`);
      console.log(`     value: ${JSON.stringify(cell.v)}`);
    }
  }

  // Also check the Packing List pallet rows
  const pl = wb.Sheets['Packing List - Pallets'];
  const plRange = XLSX.utils.decode_range(pl['!ref']);
  let plHeader = -1, plTotal = -1;
  for (let R = 0; R <= plRange.e.r; R++) {
    const b = pl[XLSX.utils.encode_cell({ r: R, c: 1 })];
    if (b && typeof b.v === 'string') {
      if (b.v.startsWith('Pallet Dimension')) plHeader = R;
      if (b.v.startsWith('GRAND TOTAL')) plTotal = R;
    }
  }
  console.log(`\n--- Packing List: header row ${plHeader + 1}, GRAND TOTAL row ${plTotal + 1}, pallet rows: ${plTotal - plHeader - 1}`);
  for (let R = plHeader; R <= plTotal; R++) {
    const cells = [];
    for (let C = 1; C <= 9; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = pl[addr];
      if (!cell || (cell.v === undefined && !cell.f)) continue;
      cells.push(`${addr}=${JSON.stringify(cell.v)}${cell.f ? ' [f: ' + cell.f + ']' : ''}`);
    }
    console.log(`  R${R + 1}: ${cells.join(' | ')}`);
  }
}
