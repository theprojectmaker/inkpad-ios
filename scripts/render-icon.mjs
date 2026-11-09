// Renders assets/icon-src/quill-icon.svg to a 1024 x 1024 RGB PNG (no alpha: the App Store refuses it)
// with headless Chrome. Usage: node scripts/render-icon.mjs [out.png]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

const out = process.argv[2] || 'assets/icon.png';
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const svg = fs.readFileSync('assets/icon-src/quill-icon.svg', 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quill-icon-'));
const html = path.join(dir, 'icon.html');
fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#1544DB">${svg}</body></html>`);
const shot = path.join(dir, 'shot.png');
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1024,1024', `--screenshot=${shot}`, 'file:///' + html.split(path.sep).join('/')], { stdio: 'ignore' });
const src = PNG.sync.read(fs.readFileSync(shot));
if (src.width !== 1024 || src.height !== 1024) throw new Error(`got ${src.width}x${src.height}`);
const rgb = new PNG({ width: 1024, height: 1024, colorType: 2, inputHasAlpha: true });
src.data.copy(rgb.data);
fs.writeFileSync(out, PNG.sync.write(rgb, { colorType: 2 }));
console.log(`wrote ${out}`);
