// Draw the logo and write the app icons. Run: node scripts/build-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const sharp = createRequire(import.meta.url)('sharp');

// The mark on its own (no background): a lens-sun over snowy peaks, with a road winding toward them.
const MARK = `
  <circle cx="45" cy="21" r="10" fill="none" stroke="#ffffff" stroke-width="2.4"/>
  <circle cx="45" cy="21" r="6" fill="#ff9a2e"/>
  <path d="M5 52 L22 25 L32 40 L39 31 L59 52 Z" fill="#ffffff"/>
  <path d="M22 25 L27 33 L22 31 L17 33 Z" fill="#cfeaf6"/>
  <path d="M31 60 C37 54 26 51 32 46 S36 42 33 38" fill="none" stroke="#ff9a2e" stroke-width="3.2" stroke-linecap="round"/>`;

const tile = (
	inner,
	scale = 1,
	radius = 14
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b2540"/><stop offset="1" stop-color="#127a99"/></linearGradient></defs>
  <rect width="64" height="64" rx="${radius}" fill="url(#g)"/>
  <g transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})">${inner}</g></svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);

await png(tile(MARK, 0.9), 192, 'static/icon-192.png');
await png(tile(MARK, 0.9), 512, 'static/icon-512.png');
await png(tile(MARK, 0.7, 0), 512, 'static/icon-maskable-512.png'); // full-bleed with safe margin
await png(tile(MARK, 0.9, 0), 180, 'static/apple-touch-icon.png');
writeFileSync('src/lib/assets/favicon.svg', tile(MARK, 0.9));
writeFileSync('static/logo.svg', tile(MARK, 0.9));
writeFileSync('src/lib/markPaths.txt', MARK.trim());
// The picture shown when a link is shared (Reddit, Facebook, messages): 1200x630.
// The states come from data/regions.json, so rerun this after adding one.
const states = JSON.parse(readFileSync('data/regions.json', 'utf8')).regions.map((r) => r.name);
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2540"/><stop offset=".62" stop-color="#16607a"/><stop offset="1" stop-color="#f59e4b"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <circle cx="1040" cy="478" r="62" fill="#ffd27a" opacity=".92"/>
  <path d="M0 630 V420 L120 330 L190 390 L310 290 L430 400 L520 350 L640 460 L760 340 L880 430 L1010 360 L1200 450 V630Z" fill="#0d3a52" opacity=".9"/>
  <path d="M0 630 V500 L150 430 L270 490 L420 410 L560 500 L700 450 L880 520 L1040 440 L1200 500 V630Z" fill="#082b3f"/>
  <path d="M600 630 C650 590 560 570 610 540 S660 500 640 470" fill="none" stroke="#ff9a2e" stroke-width="12" stroke-linecap="round"/>
  <g transform="translate(70 70) scale(2.6)">${MARK}</g>
  <text x="70" y="300" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="92" fill="#ffffff">What's Up Ahead</text>
  <text x="74" y="364" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" fill="#cfeaf6">Cameras, weather and waits along your way.</text>
  <text x="74" y="420" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="28" fill="#ff9a2e">${states.join(' · ')}</text>
</svg>`;
await sharp(Buffer.from(og)).png().toFile('static/og-image.png');
console.log('icons written');
