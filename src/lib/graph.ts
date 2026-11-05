// Reads a typed function like "y = 2x^2 - 3" and works out its curve, for Convert > Graph.
// No imports, so it can be tested on its own. Parses by hand: nothing is ever run as code.

type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs,
  ln: Math.log, log: Math.log10, exp: Math.exp, asin: Math.asin, acos: Math.acos, atan: Math.atan,
};

/** The right-hand side as a function of x, or null if it can't be read. */
export function parseFunction(input: string): Fn | null {
  const src = input.toLowerCase()
    .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/, '')
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, 'pi').replace(/√/g, 'sqrt')
    .replace(/\s+/g, '');
  if (!src || src.includes('=')) return null;
  let i = 0;
  const peek = () => src[i];

  function expr(): Fn {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const a = left, b = term();
      left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return left;
  }
  // Written side by side means times: 2x, 3(x+1), x sin(x).
  function term(): Fn {
    let left = unary();
    for (;;) {
      const c = peek();
      if (c === '*' || c === '/') {
        i++;
        const a = left, b = unary();
        left = c === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
      } else if (c !== undefined && /[a-z0-9.(]/.test(c)) {
        const a = left, b = power();
        left = (x) => a(x) * b(x);
      } else return left;
    }
  }
  function unary(): Fn {
    if (peek() === '-') { i++; const a = unary(); return (x) => -a(x); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function power(): Fn {
    const base = atom();
    if (peek() !== '^') return base;
    i++;
    const e = unary();    // to the right first: 2^3^2 is 2^9
    return (x) => Math.pow(base(x), e(x));
  }
  function atom(): Fn {
    const c = peek();
    if (c === undefined) throw new Error('end');
    if (c === '(') {
      i++;
      const v = expr();
      if (src[i++] !== ')') throw new Error('bracket');
      return v;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new Error('number');
      i += m[0].length;
      const n = Number(m[0]);
      return () => n;
    }
    if (src.startsWith('pi', i)) { i += 2; return () => Math.PI; }
    for (const name of Object.keys(FUNCS).sort((a, b) => b.length - a.length)) {
      if (src.startsWith(name, i)) {
        i += name.length;
        const f = FUNCS[name];
        const a = peek() === '(' ? atom() : power();
        return (x) => f(a(x));
      }
    }
    if (c === 'x') { i++; return (x) => x; }
    if (c === 'e') { i++; return () => Math.E; }
    throw new Error('unknown');
  }

  try {
    const f = expr();
    return i === src.length ? f : null;
  } catch { return null; }
}

export type GraphLines = {
  /** Grey lines: axes and tick marks. Each is a list of [x, y], 0 to 1 across the box, y going down. */
  axes: number[][][];
  /** The curve, in pieces wherever it leaves the box or jumps. */
  curve: number[][][];
  caption: string;
};

const niceStep = (span: number) => {
  const raw = span / 10;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
};

/** The curve for x from -10 to 10, with y scaled to what the function does. Null if it never gives a number. */
export function graphLines(text: string, xMin = -10, xMax = 10, steps = 480): GraphLines | null {
  const f = parseFunction(text);
  if (!f) return null;
  const xs = Array.from({ length: steps + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / steps);
  const ys = xs.map((x) => f(x));
  const sane = ys.filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  if (!sane.length) return null;

  // The middle of what it does: a spike at a tan or 1/x asymptote shouldn't flatten the rest.
  let yMin = sane[Math.floor(sane.length * 0.04)];
  let yMax = sane[Math.ceil(sane.length * 0.96) - 1];
  if (yMax - yMin < 4) { const m = (yMax + yMin) / 2; yMin = m - 2; yMax = m + 2; }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad; yMax += pad;
  if (yMin > 0 && yMin < (yMax - yMin) * 0.5) yMin = -pad;
  if (yMax < 0 && -yMax < (yMax - yMin) * 0.5) yMax = pad;

  const nx = (x: number) => (x - xMin) / (xMax - xMin);
  const ny = (y: number) => 1 - (y - yMin) / (yMax - yMin);

  const curve: number[][][] = [];
  let cur: number[][] = [];
  const jump = (yMax - yMin) * 1.5;
  ys.forEach((y, i) => {
    const off = !Number.isFinite(y) || y < yMin || y > yMax;
    const broke = i > 0 && Number.isFinite(ys[i - 1]) && Math.abs(y - ys[i - 1]) > jump;
    if (off || broke) {
      if (cur.length > 1) curve.push(cur);
      cur = [];
      if (off) return;
    }
    cur.push([nx(xs[i]), ny(y)]);
  });
  if (cur.length > 1) curve.push(cur);

  const axes: number[][][] = [];
  const x0 = nx(0), y0 = Math.max(0, Math.min(1, ny(0)));
  axes.push([[0, y0], [1, y0]], [[x0, 0], [x0, 1]]);
  const tick = 0.012;
  const xStep = niceStep(xMax - xMin), yStep = niceStep(yMax - yMin);
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax; v += xStep) if (Math.abs(v) > xStep / 2) axes.push([[nx(v), y0 - tick], [nx(v), y0 + tick]]);
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) if (Math.abs(v) > yStep / 2) axes.push([[x0 - tick, ny(v)], [x0 + tick, ny(v)]]);

  const round = (n: number) => Number(n.toPrecision(3));
  const clean = text.trim();
  return { axes, curve, caption: `${/^(y|f)/i.test(clean) ? clean : `y = ${clean}`}    x: ${xMin} to ${xMax}, y: ${round(yMin)} to ${round(yMax)}, ticks every ${round(xStep)} and ${round(yStep)}` };
}
