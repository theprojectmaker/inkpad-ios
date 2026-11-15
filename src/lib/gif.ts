// A small animated-GIF writer, so a drawing board animation can leave the app as one file.
// The colours are a fixed 6x6x6 cube with a little ordered dithering: not photographic, fine for drawings.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** RGBA pixels to palette indexes (0...215). */
export function toIndexes(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 3.2;
      const q = (v: number) => Math.max(0, Math.min(5, Math.round((v + t) / 51)));
      out[y * w + x] = q(rgba[i]) * 36 + q(rgba[i + 1]) * 6 + q(rgba[i + 2]);
    }
  }
  return out;
}

/** GIF's flavour of LZW over 8-bit indexes. */
function lzw(indexes: Uint8Array): number[] {
  const minBits = 8;
  const clear = 1 << minBits, eoi = clear + 1;
  const out: number[] = [];
  let cur = 0, curBits = 0;
  const put = (code: number, bits: number) => {
    cur |= code << curBits;
    curBits += bits;
    while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  let dict = new Map<number, number>();
  let next = eoi + 1, bits = minBits + 1;
  put(clear, bits);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const c = indexes[i];
    const key = prefix * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix, bits);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << bits) && bits < 12) bits++;
    } else {
      put(clear, bits);
      dict = new Map();
      next = eoi + 1;
      bits = minBits + 1;
    }
    prefix = c;
  }
  put(prefix, bits);
  put(eoi, bits);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

/** frames: palette indexes per frame (see toIndexes). delay: hundredths of a second per frame. */
export function encodeGif(frames: Uint8Array[], w: number, h: number, delay: number): Uint8Array {
  const b: number[] = [];
  const u16 = (v: number) => b.push(v & 255, (v >> 8) & 255);
  for (const ch of 'GIF89a') b.push(ch.charCodeAt(0));
  u16(w); u16(h);
  b.push(0xf7, 0, 0);                       // a 256-colour global palette
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let bl = 0; bl < 6; bl++) b.push(r * 51, g * 51, bl * 51);
  for (let i = 216; i < 256; i++) b.push(0, 0, 0);
  b.push(0x21, 0xff, 11);                   // loop forever
  for (const ch of 'NETSCAPE2.0') b.push(ch.charCodeAt(0));
  b.push(3, 1, 0, 0, 0);
  for (const f of frames) {
    b.push(0x21, 0xf9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0);   // keep the last frame under the next
    b.push(0x2c); u16(0); u16(0); u16(w); u16(h); b.push(0);
    b.push(8);
    const data = lzw(f);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      b.push(n);
      for (let k = 0; k < n; k++) b.push(data[i + k]);
    }
    b.push(0);
  }
  b.push(0x3b);
  return new Uint8Array(b);
}
