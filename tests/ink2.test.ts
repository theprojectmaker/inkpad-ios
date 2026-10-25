import assert from 'node:assert/strict';
import { test } from 'node:test';

import { densify, filterPt, inkOutline, inkOutline2, jitterK, outlineSvg } from '../src/lib/ink';
import type { Pt } from '../src/lib/geom';

// A slow handwriting-like wave with +-0.6 units of pencil jitter on every sample.
const jittery = (n: number): Pt[] => Array.from({ length: n }, (_, i) => ({ x: i * 0.8 + Math.sin(i * 7.3) * 0.6, y: Math.sin(i / 14) * 12 + Math.cos(i * 5.1) * 0.6, p: 0.5 }));
const filtered = (raw: Pt[], sm = 0.4) => { const out: Pt[] = []; let f: Pt | undefined; for (const r of raw) { f = filterPt(f, r, jitterK(sm, 1)); out.push(f); } return out; };
// widest vertical extent of the outline across short windows = blob detector
const maxWidth = (poly: number[][], x0: number, x1: number) => {
  let m = 0;
  for (let x = x0; x < x1; x += 2) {
    const ys = poly.filter((q) => Math.abs(q[0] - x) < 1).map((q) => q[1]);
    if (ys.length) m = Math.max(m, Math.max(...ys) - Math.min(...ys));
  }
  return m;
};

test('clean ink: finite, one contour, for every style', () => {
  for (const kind of ['fountain', 'ball', 'brush', 'marker', 'pencil', 'fine', 'hl'] as const) for (const pressure of [true, false]) {
    for (const pts of [jittery(1), jittery(2), jittery(200)]) {
      const d = outlineSvg(inkOutline2(filtered(pts), 2, kind, pressure, { last: true }));
      assert.ok(d.startsWith('M') && d.endsWith('Z') && !/NaN|Infinity/.test(d), kind);
      assert.equal((d.match(/M/g) || []).length, 1);
    }
  }
});

test('jitter no longer makes blobs', () => {
  const raw = jittery(240);
  const before = maxWidth(inkOutline(raw, 2, 'ball', true, { last: true }), 20, 170);
  const after = maxWidth(inkOutline2(filtered(raw), 2, 'ball', true, { last: true }), 20, 170);
  // the wave's slope adds some vertical extent; blobs add a lot more
  assert.ok(after < before, `after ${after} < before ${before}`);
  assert.ok(after < 2 * 2.2 + 2, 'clean width ' + after);
});

test('densify is even and passes through the points', () => {
  const pts: Pt[] = [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }, { x: 10, y: 10, p: 0.5 }];
  const d = densify(pts, 0.5);
  assert.deepEqual([d[0].x, d[0].y], [0, 0]);
  assert.deepEqual([d[d.length - 1].x, d[d.length - 1].y], [10, 10]);
  for (let i = 1; i < d.length; i++) assert.ok(Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y) < 0.9);
  // chunks see the same curve as the whole
  const whole = densify(jittery(30), 0.4), a = densify(jittery(30), 0.4, 0, 15), b = densify(jittery(30), 0.4, 15);
  assert.equal(a.length + b.length - 1, whole.length);
});

test('filter follows big moves and absorbs tiny ones', () => {
  const k = jitterK(0.4, 1);
  const big = filterPt({ x: 0, y: 0, p: 0.5 }, { x: 30, y: 0, p: 0.5 }, k);
  const tiny = filterPt({ x: 0, y: 0, p: 0.5 }, { x: 0.3, y: 0, p: 0.5 }, k);
  assert.ok(big.x > 29, 'big ' + big.x);
  assert.ok(tiny.x < 0.15, 'tiny ' + tiny.x);
});
