import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eraseSplit, pack, recognizeShape, strokeBands, strokeHit, strokeInLasso, unpack, xfStroke, type Pt } from '../src/lib/geom';
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

test('bands have no NaN for odd input', () => {
  const cases: Pt[][] = [
    [{ x: 5, y: 5, p: 0.5 }], [{ x: 5, y: 5, p: 0.5 }, { x: 5, y: 5, p: 0.5 }],
    line(0, 0, 100, 0), line(0, 0, 0.1, 0.1, 5), [{ x: 0, y: 0, p: NaN }, { x: 10, y: 10, p: Infinity }, { x: 20, y: 0, p: -1 }],
  ];
  for (const c of cases) for (const pr of [true, false]) {
    const bands = strokeBands(mk(c, pr ? { pr: 1 } : {}));
    assert.ok(bands.length >= 1, 'something is drawn');
    for (const bd of bands) { assert.ok(!/NaN|Infinity/.test(bd.d)); assert.ok(bd.w > 0 && Number.isFinite(bd.w)); }
  }
  const hl = strokeBands(mk(line(0, 0, 50, 50), { kind: 'hl', w: 16 }));
  assert.equal(hl.length, 1, 'highlighter is one band (even transparency)');
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

import { buildSamples, InkBuilder, samplesBands } from '../src/lib/geom';

test('live stroke equals the saved stroke (no jump on lift)', () => {
  const pts = Array.from({ length: 80 }, (_, i) => ({ x: i * 2.3, y: Math.sin(i / 6) * 30, p: 0.3 + 0.4 * Math.abs(Math.sin(i / 9)) }));
  for (const mode of ['fountain', 'ball', 'even'] as const) {
    const b = new InkBuilder(2, mode);
    for (const q of pts) b.add(q);
    const live = [...b.samples, ...b.tail()].map((s) => [s.x, s.y, s.r].map((v) => v.toFixed(4)).join());
    const full = buildSamples(pts, 2, mode).map((s) => [s.x, s.y, s.r].map((v) => v.toFixed(4)).join());
    assert.deepEqual(live, full, mode);
  }
});

test('pressure spikes cannot make blobs (width is rate limited)', () => {
  const pts = Array.from({ length: 120 }, (_, i) => ({ x: i * 1.5, y: 0, p: i % 2 ? 1 : 0 }));
  const s = buildSamples(pts, 3, 'fountain');
  for (let i = 1; i < s.length; i++) {
    const d = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    assert.ok(Math.abs(s[i].r - s[i - 1].r) <= 0.4 * Math.max(d, 0.25) + 0.02, `jump at ${i}`);
  }
  const rs = s.map((q) => q.r);
  assert.ok(Math.max(...rs) - Math.min(...rs.slice(10)) < 1.2, 'stays even');
});

test('bands: few paths per stroke, widths follow pressure smoothly', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ x: i * 1.2, y: Math.sin(i / 10) * 20, p: 0.2 + 0.6 * (i / 200) }));
  const bands = samplesBands(buildSamples(pts, 2, 'fountain'), 2, false);
  assert.ok(bands.length >= 3 && bands.length <= 30, 'band count ' + bands.length);
  const ws = bands.map((b) => b.w);
  assert.ok(Math.max(...ws) / Math.min(...ws) < 2.4, 'no extreme widths');
});
