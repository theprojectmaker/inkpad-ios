import fs from 'node:fs';
import { inkOutline, outlineSvg } from '../src/lib/ink';
import { unpack } from '../src/lib/geom';
const CK = require('canvaskit-wasm/bin/full/canvaskit.js');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  const ck = await CK();
  const surf = ck.MakeSurface(1200, 500);
  const c = surf.getCanvas();
  c.clear(ck.WHITE);
  const paint = new ck.Paint(); paint.setAntiAlias(true); paint.setColor(ck.BLACK);
  let row = 0;
  for (const [w, style] of [[5, 'finger'], [1.4, 'fountain'], [1.4, 'finger']] as const) {
    c.save(); c.translate(-80, -120 + row * 150); c.scale(1.6, 1.6);
    for (const s of data) {
      const d = outlineSvg(inkOutline(unpack(s.pts), w, style, { last: true }));
      const p = ck.Path.MakeFromSVGString(d);
      if (p) c.drawPath(p, paint); else console.log('null path');
    }
    c.restore(); row++;
  }
  const img = surf.makeImageSnapshot();
  fs.writeFileSync(process.argv[3], Buffer.from(img.encodeToBytes()));
})();
