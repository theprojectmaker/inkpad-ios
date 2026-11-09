// Draws Quill's app icon as pixel art: a white quill feather writing a blue ink line, on a
// blue background, on a 32 x 32 grid scaled up with hard edges. No transparency (the App Store
// refuses icons with an alpha channel). Usage: node scripts/make-pixel-icon.cjs [out.png] [size]
const fs = require('fs');
const zlib = require('zlib');

const N = 32;
const out = process.argv[2] || 'assets/images/icon.png';
const size = Number(process.argv[3] || 1024);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const C = {
  outline: hex('#2A1650'), vane: hex('#FFFFFF'), vaneShade: hex('#D6F4FF'), vaneDeep: hex('#8FD3FF'),
  vaneTeal: hex('#4FE0C8'), vaneTealDeep: hex('#22B8A8'), vaneGold: hex('#FFE07A'), vaneGoldDeep: hex('#FFB547'),
  shaft: hex('#7A4A20'), nib: hex('#2B2F4A'), nibShine: hex('#FFD34D'), ink: hex('#FFFFFF'), inkDeep: hex('#FFE07A'),
  spark: hex('#FFF6B0'), sparkWhite: hex('#FFFFFF'),
};
// Sunset bands, top to bottom, with a checker of the two colours where they meet (a pixel-art gradient).
const BANDS = ['#FFB25A', '#FF8A5C', '#FF5F7E', '#E048A8', '#A945D8', '#6E45E4'].map(hex);

const grid = Array.from({ length: N }, () => Array(N).fill(null));
// Background: soft bands from the top, a darker rim.
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const f = (y + x * 0.35) / (N + N * 0.35) * BANDS.length;
  let i = Math.min(BANDS.length - 1, Math.floor(f));
  if (f - i > 0.78 && i < BANDS.length - 1 && (x + y) % 2 === 0) i++;   // dithered seam
  grid[y][x] = BANDS[i];
}

// The quill: its shaft runs from the nib (bottom left) to the tip (top right).
const nib = [7.5, 24.5], tip = [26.5, 5.5];
const dx = tip[0] - nib[0], dy = tip[1] - nib[1], len = Math.hypot(dx, dy);
const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;   // along the shaft, and across it
const vane = new Set();
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const px = x + 0.5 - nib[0], py = y + 0.5 - nib[1];
  const t = (px * ux + py * uy) / len;        // 0 at the nib, 1 at the tip
  const s = px * nx + py * ny;                // which side of the shaft, and how far
  if (t < 0.24 || t > 1.02) continue;
  const k = (t - 0.24) / 0.78;
  // Wider on one side, curving out then tapering to the tip.
  const wide = Math.sin(Math.min(1, k * 1.15) * Math.PI) * (s < 0 ? 4.6 : 3.4) + (k < 0.15 ? 0 : 0.6);
  const notch = (Math.floor(t * 26) % 6 === 0 && Math.abs(s) > wide - 1.2) ? 1 : 0;   // a few gaps in the barbs
  if (Math.abs(s) <= wide - notch) vane.add(y * N + x);
}
// Shading: the lower side of the feather is a little darker, deeper near the shaft's base.
for (const i of vane) {
  const x = i % N, y = (i / N) | 0;
  const px = x + 0.5 - nib[0], py = y + 0.5 - nib[1];
  const s = px * nx + py * ny, t = (px * ux + py * uy) / len;
  const deep = s < -2.2, mid = s < -0.6;
  if (t < 0.42) grid[y][x] = deep ? C.vaneTealDeep : C.vaneTeal;
  else if (t > 0.84) grid[y][x] = deep || mid ? C.vaneGoldDeep : C.vaneGold;
  else grid[y][x] = deep ? C.vaneDeep : mid ? C.vaneShade : C.vane;
}
// Outline every feather pixel's empty neighbours.
const isVane = (x, y) => vane.has(y * N + x);
for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
  if (isVane(x, y)) continue;
  if (isVane(x + 1, y) || isVane(x - 1, y) || isVane(x, y + 1) || isVane(x, y - 1)) grid[y][x] = C.outline;
}
// The shaft through the feather.
for (let t = 0.24; t <= 0.96; t += 0.01) {
  const x = Math.floor(nib[0] + dx * t), y = Math.floor(nib[1] + dy * t);
  if (isVane(x, y)) grid[y][x] = C.shaft;
}
// The nib: dark metal with one bright pixel, pointing down-left.
for (let t = 0; t <= 0.27; t += 0.005) {
  const x = Math.floor(nib[0] + dx * t), y = Math.floor(nib[1] + dy * t);
  grid[y][x] = C.nib;
  if (t > 0.08 && y + 1 < N) grid[y + 1][x] = C.nib;     // a little thicker towards the feather
}
{ const t = 0.17; grid[Math.floor(nib[1] + dy * t)][Math.floor(nib[0] + dx * t)] = C.nibShine; }
// The line it's writing: a golden ink stroke with a little wave.
const line = [[3, 28], [4, 28], [5, 27], [6, 28], [7, 28], [8, 29], [9, 28], [10, 28], [11, 27], [12, 28], [13, 28], [14, 29], [15, 28], [16, 28]];
line.forEach(([x, y], i) => { grid[y][x] = i % 4 === 3 ? C.inkDeep : C.ink; });
grid[27][4] = C.ink;

// Sparkles around the quill.
const plus = (x, y, c, big) => { grid[y][x] = c; if (big) { grid[y - 1][x] = c; grid[y + 1][x] = c; grid[y][x - 1] = c; grid[y][x + 1] = c; } };
plus(5, 6, C.sparkWhite, true); plus(27, 18, C.spark, true); plus(22, 26, C.sparkWhite, false); plus(9, 12, C.spark, false); plus(28, 27, C.spark, false);

// Scale up with hard pixel edges and write a PNG (RGB, no alpha).
const scale = size / N;
const raw = Buffer.alloc((size * 3 + 1) * size);
for (let y = 0; y < size; y++) {
  raw[y * (size * 3 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const c = grid[Math.floor(y / scale)][Math.floor(x / scale)];
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
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${size}x${size}, ${Math.round(png.length / 1024)} KB)`);
