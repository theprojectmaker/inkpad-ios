// Quill's app icon, drawn smooth (not pixel art): a white quill feather with a navy outline and a
// gold shaft, writing a blue ink line, on warm paper with a soft shadow. Anti-aliased by sampling
// each pixel 4 x 4 times. No transparency (the App Store refuses alpha).
// Usage: node scripts/make-icon.cjs <out.png> [size]
const fs = require('fs');
const zlib = require('zlib');

const out = process.argv[2] || 'assets/icon.png';
const size = Number(process.argv[3] || 1024);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// ---- Geometry, in 0..1 units ----
const bez = (p0, p1, p2, p3, n) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
});
const base = [0.335, 0.665], tip = [0.79, 0.17];
// The vane: a fuller upper-left side, a slimmer lower-right side, meeting at a soft point.
const upper = bez(base, [0.24, 0.47], [0.50, 0.17], tip, 80);
const lower = bez(tip, [0.80, 0.36], [0.56, 0.62], base, 80);
const vane = [...upper, ...lower.slice(1)];
const notches = [];
const shaft = bez([0.30, 0.70], [0.46, 0.50], [0.62, 0.32], [0.775, 0.185], 60);
const nib = [[0.335, 0.665], [0.30, 0.70], [0.205, 0.815], [0.192, 0.832], [0.215, 0.822], [0.322, 0.718], [0.36, 0.684]];
const ink = bez([0.19, 0.855], [0.32, 0.80], [0.40, 0.90], [0.53, 0.85], 60).concat(bez([0.53, 0.85], [0.60, 0.825], [0.66, 0.86], [0.72, 0.845], 40).slice(1));

// ---- Tests ----
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};
const lineDist = (x, y, pts, closed) => {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, y, pts[i], pts[i + 1]));
  if (closed) d = Math.min(d, segDist(x, y, pts[pts.length - 1], pts[0]));
  return d;
};
const box = (pts, pad) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
};
const inBox = (x, y, b) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3];
const vaneBox = box(vane, 0.03), nibBox = box(nib, 0.02), inkBox = box(ink, 0.03);

const C = {
  paperTop: hex('#FFF9EE'), paperLow: hex('#F2DFC0'), navy: hex('#1F2C5E'), white: hex('#FFFFFF'),
  shade: hex('#DCE6FF'), shadeDeep: hex('#AFC2F5'), shaft: hex('#C0904F'), nibHi: hex('#5B6FB8'), ink: hex('#2F5BFF'),
};
const SH = [0.018, 0.022];   // shadow offset

// The colour of one sample point.
function sample(x, y) {
  let c = mix(C.paperTop, C.paperLow, Math.min(1, y * 0.85 + x * 0.15));
  // Soft shadow under the quill and nib.
  const sx = x - SH[0], sy = y - SH[1];
  if ((inBox(sx, sy, vaneBox) && inPoly(sx, sy, vane)) || (inBox(sx, sy, nibBox) && inPoly(sx, sy, nib))) c = mix(c, [150, 120, 80], 0.22);
  // Ink line.
  if (inBox(x, y, inkBox) && lineDist(x, y, ink, false) < 0.016) c = C.ink;
  // Feather.
  if (inBox(x, y, vaneBox)) {
    const inside = inPoly(x, y, vane) && !notches.some((n) => inPoly(x, y, n));
    if (inside) {
      // Which side of the shaft: the lower side is shaded, deeper towards its edge.
      const sd = lineDist(x, y, shaft, false);
      const lowerSide = (x - 0.30) * (0.185 - 0.70) - (y - 0.70) * (0.775 - 0.30) < 0;
      c = lowerSide ? mix(C.shade, C.shadeDeep, Math.min(1, sd / 0.09)) : mix(C.white, C.shade, Math.max(0, (sd - 0.07) / 0.12) * 0.5);
      if (sd < 0.0075) c = C.shaft;
    }
    const edge = Math.min(lineDist(x, y, vane, true), ...notches.map((n) => lineDist(x, y, n, false)));
    if (edge < 0.0105 && (inside || edge < 0.0105)) {
      if (inside || edge < 0.0105) c = C.navy;
    }
  }
  // Nib, drawn over the base of the feather.
  if (inBox(x, y, nibBox)) {
    if (inPoly(x, y, nib)) c = segDist(x, y, [0.315, 0.69], [0.23, 0.79]) < 0.006 ? C.nibHi : C.navy;
    else if (lineDist(x, y, nib, true) < 0.006) c = C.navy;
  }
  return c;
}

const S = 4;   // 4 x 4 samples per pixel
const raw = Buffer.alloc((size * 3 + 1) * size);
for (let py = 0; py < size; py++) {
  raw[py * (size * 3 + 1)] = 0;
  for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const c = sample((px + (i + 0.5) / S) / size, (py + (j + 0.5) / S) / size);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = py * (size * 3 + 1) + 1 + px * 3;
    raw[o] = Math.round(r / (S * S)); raw[o + 1] = Math.round(g / (S * S)); raw[o + 2] = Math.round(b / (S * S));
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} (${size}px)`);
