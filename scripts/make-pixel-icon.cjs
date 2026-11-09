// Quill's app icon: a hand-placed 16 x 16 pixel quill (big, deliberate pixels) on a smooth
// background with a soft shadow. No transparency (the App Store refuses alpha).
// Usage: node scripts/make-pixel-icon.cjs <out.png> [size] [style]   style: dusk | paper | sun
const fs = require('fs');
const zlib = require('zlib');

const out = process.argv[2] || 'assets/icon.png';
const size = Number(process.argv[3] || 1024);
const style = process.argv[4] || 'dusk';
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// The quill, drawn by hand. K outline, W feather, L feather shade, D deeper shade, S shaft,
// N nib, n nib shine, I ink.
const SPRITE = [
  '...........KKK..',
  '.........KKWWLK.',
  '........KWWWWLK.',
  '.......KWWWWSLK.',
  '......KWWWWSLDK.',
  '.....KWWWWSLLDK.',
  '....KWWWWSLLDK..',
  '....KWWWSLLDDK..',
  '...KWWWSLLDDK...',
  '...KWWSLLDDK....',
  '...KWSLLDKK.....',
  '..KNSKKKK.......',
  '..KnNK..........',
  '.KNNK...........',
  '.KNK...IIII.....',
  '.KK..IIIIIIII...',
];

const STYLES = {
  // Deep blue to violet, white feather, gold nib.
  dusk: { top: '#4D6BFF', bottom: '#8A3FE0', K: '#191540', W: '#FFFFFF', L: '#D5E3FF', D: '#A9BFFF', S: '#C9A36A', N: '#FFC940', n: '#FFF3B0', I: '#FFC940', shadow: [12, 6, 40] },
  // Warm paper, navy ink quill: calm and bookish.
  paper: { top: '#FFF8EC', bottom: '#F3E2C4', K: '#1E2B5C', W: '#FFFFFF', L: '#DCE6FF', D: '#9FB4F2', S: '#B88A4E', N: '#1E2B5C', n: '#7F92D6', I: '#2F5BFF', shadow: [120, 90, 40] },
  // Bright yellow like a notepad, dark quill.
  sun: { top: '#FFD84A', bottom: '#FFB21F', K: '#2A1E10', W: '#FFFFFF', L: '#FFF1C2', D: '#F2C766', S: '#8A5A22', N: '#2A1E10', n: '#9C7A45', I: '#2A1E10', shadow: [120, 70, 0] },
};
const P = STYLES[style];
if (!P) throw new Error('style: dusk | paper | sun');

const px = Math.floor(size * 0.75 / 16);          // one sprite pixel
const off = Math.floor((size - px * 16) / 2);
const top = hex(P.top), bottom = hex(P.bottom);
const raw = Buffer.alloc((size * 3 + 1) * size);
const cell = (x, y) => {
  const sx = Math.floor((x - off) / px), sy = Math.floor((y - off) / px);
  if (sx < 0 || sy < 0 || sx > 15 || sy > 15) return null;
  const ch = SPRITE[sy][sx];
  return ch === '.' ? null : hex(P[ch]);
};
const sh = Math.round(px * 0.35);   // shadow offset
for (let y = 0; y < size; y++) {
  raw[y * (size * 3 + 1)] = 0;
  const f = y / (size - 1);
  for (let x = 0; x < size; x++) {
    // Smooth diagonal gradient.
    const g = Math.min(1, Math.max(0, f * 0.8 + (x / size) * 0.2));
    let c = [0, 1, 2].map((i) => Math.round(top[i] + (bottom[i] - top[i]) * g));
    const p = cell(x, y);
    if (!p && cell(x - sh, y - sh)) c = c.map((v, i) => Math.round(v * 0.72 + P.shadow[i] * 0.28));   // soft drop shadow
    if (p) c = p;
    const o = y * (size * 3 + 1) + 1 + x * 3;
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} (${style}, ${size}px)`);
