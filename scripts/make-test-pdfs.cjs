// Makes PDFs for the simulator test: short, long, and heavy like a scanned packet.
// node scripts/make-test-pdfs.cjs <folder>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function build(file, pages, image) {
  const parts = [];
  let at = 0;
  const offsets = [];
  const put = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(x); at += x.length; };
  const obj = (n, body, stream) => {
    offsets[n] = at;
    put(`${n} 0 obj\n`);
    if (stream) { put(`<< ${body} /Length ${stream.length} >>\nstream\n`); put(stream); put('\nendstream'); } else put(body);
    put('\nendobj\n');
  };
  put('%PDF-1.4\n');
  const perPage = image ? 3 : 2;   // page, its text, and (heavy files) its picture
  const firstPage = 4;
  const kids = Array.from({ length: pages }, (_, i) => `${firstPage + i * perPage} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const n = firstPage + i * perPage;
    const res = image ? `/Font << /F1 3 0 R >> /XObject << /Im ${n + 2} 0 R >>` : '/Font << /F1 3 0 R >>';
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${n + 1} 0 R /Resources << ${res} >> >>`);
    let c = '';
    if (image) c += 'q 500 0 0 620 56 110 cm /Im Do Q\n';
    c += `BT /F1 36 Tf 56 730 Td (Test page ${i + 1} of ${pages}) Tj ET\n`;
    if (!image) for (let l = 0; l < 26; l++) c += `BT /F1 13 Tf 56 ${680 - l * 24} Td (Line ${l + 1}: the quick brown fox on page ${i + 1}.) Tj ET\n`;
    obj(n + 1, '', Buffer.from(c, 'latin1'));
    if (image) {
      const w = 460, h = 600;
      obj(n + 2, `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8`, crypto.randomBytes(w * h * 3));
    }
  }
  const count = firstPage + pages * perPage;
  const xref = at;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  fs.writeFileSync(file, Buffer.concat(parts));
  console.log(path.basename(file), (at / 1048576).toFixed(1) + ' MB');
}

const dir = process.argv[2] || '.';
fs.mkdirSync(dir, { recursive: true });
build(path.join(dir, 'T5.pdf'), 5, false);
build(path.join(dir, 'T200.pdf'), 200, false);
build(path.join(dir, 'THeavy60.pdf'), 60, true);
