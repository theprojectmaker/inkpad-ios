import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inkOutline, outlineSvg, strokeSvg } from '../src/lib/ink';
import { pack } from '../src/lib/geom';

const line = (n: number, p = 0.5) => Array.from({ length: n }, (_, i) => ({ x: i * 2, y: Math.sin(i / 8) * 10, p }));
const widthAt = (poly: number[][], x: number) => {
  // vertical extent of the outline near x
  const ys = poly.filter((q) => Math.abs(q[0] - x) < 1.5).map((q) => q[1]);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
};

test('outlines are finite, closed and single-path', () => {
  for (const style of ['fountain', 'ball', 'finger', 'hl'] as const) {
    for (const pts of [line(1), line(2), line(80), [{ x: 0, y: 0, p: NaN }, { x: 5, y: 5, p: 2 }, { x: 10, y: 0, p: -1 }]]) {
      const d = outlineSvg(inkOutline(pts, 2, style, { last: true }));
      assert.ok(d.startsWith('M') && d.endsWith('Z'), style);
      assert.ok(!/NaN|Infinity/.test(d));
      assert.equal((d.match(/M/g) || []).length, 1, 'one contour');
    }
  }
});

test('fountain ends taper; eraser-cut ends stay full width', () => {
  const pts = Array.from({ length: 60 }, (_, i) => ({ x: i * 2, y: 0, p: 0.5 }));
  const tapered = inkOutline(pts, 3, 'fountain', { last: true });
  const cut = inkOutline(pts, 3, 'fountain', { last: true, cutStart: true, cutEnd: true });
  assert.ok(widthAt(tapered, 0) < widthAt(tapered, 60) * 0.3, 'start tapers to a point');
  assert.ok(widthAt(cut, 0) > widthAt(tapered, 60) * 0.8, 'cut start stays full width');
  const w = widthAt(tapered, 60);
  assert.ok(w > 3 * 0.8 && w < 3 * 1.4, 'normal pressure ~ chosen size: ' + w);
});

test('ballpoint is nearly even even with jumpy pressure', () => {
  const pts = Array.from({ length: 80 }, (_, i) => ({ x: i * 2, y: 0, p: i % 2 ? 0.9 : 0.1 }));
  const poly = inkOutline(pts, 2, 'ball', { last: true });
  const ws = [30, 60, 90, 120].map((x) => widthAt(poly, x));
  assert.ok(Math.max(...ws) - Math.min(...ws) < 0.8, ws.join());
});

test('saved stroke svg uses stored flags', () => {
  const s = { id: 's', kind: 'pen' as const, color: '#000', w: 2, pts: pack(line(40)), pr: 1 as const, c0: 1 as const };
  assert.ok(strokeSvg(s).length > 100);
});
