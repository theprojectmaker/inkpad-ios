import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eraseSplit, outlinePath, pack, recognizeShape, strokeHit, strokeInLasso, strokePath, unpack, xfStroke, type Pt } from '../src/lib/geom';
import type { Stroke } from '../src/lib/model';
import { paperMarks, paperSvg } from '../src/lib/paper';

const line = (x0: number, y0: number, x1: number, y1: number, n = 30, p = 0.5): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, p }));
const mk = (pts: Pt[], extra: Partial<Stroke> = {}): Stroke => ({ id: 's', kind: 'pen', color: '#000', w: 2, pts: pack(pts), ...extra });

test('pack/unpack round trip drops NaN', () => {
  const pts = [{ x: 1, y: 2, p: 0.5 }, { x: NaN, y: 3, p: 0.2 }, { x: 4.04, y: 5.06, p: 2 }];
  const back = unpack(pack(pts));
  assert.equal(back.length, 2);
  assert.deepEqual(back[1], { x: 4, y: 5.1, p: 1 });
});

test('outline has no NaN for odd input', () => {
  const cases: Pt[][] = [
    [], [{ x: 5, y: 5, p: 0.5 }], [{ x: 5, y: 5, p: 0.5 }, { x: 5, y: 5, p: 0.5 }],
    line(0, 0, 100, 0), line(0, 0, 0.1, 0.1, 5), [{ x: 0, y: 0, p: NaN }, { x: 10, y: 10, p: Infinity }, { x: 20, y: 0, p: -1 }],
  ];
  for (const c of cases) {
    for (const pressure of [true, false]) {
      const d = outlinePath(c, 2, { pressure, taper: !pressure });
      assert.ok(!/NaN|Infinity/.test(d), d);
      if (c.length) assert.ok(d.startsWith('M') && d.endsWith('Z'));
    }
  }
  assert.ok(!/NaN/.test(strokePath(mk(line(0, 0, 50, 50), { kind: 'hl', w: 16 }))));
});

test('eraser splits a line into two pieces', () => {
  const s = mk(line(0, 0, 100, 0, 50));
  assert.equal(eraseSplit(s, 50, 30, 5), null);
  const pieces = eraseSplit(s, 50, 0, 5)!;
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0].every((q) => q.x < 46));
  assert.ok(pieces[1].every((q) => q.x > 54));
});

test('hit test and lasso', () => {
  const s = mk(line(10, 10, 90, 10));
  assert.ok(strokeHit(s, 50, 12, 2));
  assert.ok(!strokeHit(s, 50, 30, 2));
  const poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }];
  assert.ok(strokeInLasso(s, poly));
  assert.ok(!strokeInLasso(mk(line(10, 50, 90, 50)), poly));
});

test('shapes: line, rectangle, ellipse, scribble', () => {
  const wobbly = line(0, 0, 200, 4, 60).map((q, i) => ({ ...q, y: q.y + Math.sin(i) * 1.5 }));
  assert.equal(recognizeShape(wobbly)?.kind, 'line');
  const rect = [...line(0, 0, 200, 0), ...line(200, 0, 200, 100), ...line(200, 100, 0, 100), ...line(0, 100, 0, 3)];
  assert.equal(recognizeShape(rect)?.kind, 'rect');
  const circ = Array.from({ length: 80 }, (_, i) => { const a = (i / 79) * Math.PI * 2; return { x: 100 + Math.cos(a) * 60, y: 100 + Math.sin(a) * 40, p: 0.5 }; });
  assert.equal(recognizeShape(circ)?.kind, 'ellipse');
  const tri = [...line(0, 100, 100, 0), ...line(100, 0, 200, 100), ...line(200, 100, 2, 100)];
  assert.equal(recognizeShape(tri)?.kind, 'triangle');
  const zig = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: (i % 2) * 40, p: 0.5 }));
  assert.equal(recognizeShape(zig), null);
});

test('transform moves and scales points', () => {
  const s = xfStroke(mk([{ x: 10, y: 10, p: 0.5 }, { x: 20, y: 10, p: 0.5 }]), { dx: 5, dy: 0, s: 2, ox: 10, oy: 10 });
  assert.deepEqual(unpack(s.pts).map((q) => [q.x, q.y]), [[15, 10], [35, 10]]);
});

test('paper marks', () => {
  assert.equal(paperMarks('blank', 'white', 612, 792).length, 0);
  assert.ok(paperMarks('lined', 'white', 612, 792).length > 20);
  for (const g of paperSvg('dotted', 'dark', 612, 792)) assert.ok(!/NaN/.test(g.d));
});
