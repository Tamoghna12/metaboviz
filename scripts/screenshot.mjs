import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const BASE = 'http://localhost:5173';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── 1. Landing page ──────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle2' });
await delay(1500);
await page.screenshot({ path: `${OUT}/landing.png` });
console.log('✓ landing.png');

// ── 2. Upload screen (inside the GEM visualizer) ─────────────────────────────
// Click "Load a Model" to navigate into the visualizer upload area
const loadBtn = await page.$('button[class*="bg-[var(--primary)]"], a[href*="visualiz"]');
if (loadBtn) {
  await loadBtn.click();
  await delay(1000);
}
await page.screenshot({ path: `${OUT}/upload.png` });
console.log('✓ upload.png');

// ── 3. Load E. coli example ───────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle2' });
await delay(1000);

// Find and click "Try E. coli Example" button
const ecoliBtn = await page.$$eval('button', btns => {
  const b = btns.find(b => b.textContent.includes('E. coli'));
  if (b) { b.click(); return true; }
  return false;
});
await delay(3000); // wait for model to load

// ── 4. Pathways overview ──────────────────────────────────────────────────────
await page.screenshot({ path: `${OUT}/pathways.png` });
console.log('✓ pathways.png');

// ── 5. Treemap view ──────────────────────────────────────────────────────────
// Look for treemap toggle button
const treemapBtn = await page.$$eval('button', btns => {
  const b = btns.find(b => b.textContent.includes('Treemap') || b.title === 'Treemap');
  if (b) { b.click(); return true; }
  return false;
});
await delay(800);
await page.screenshot({ path: `${OUT}/treemap.png` });
console.log('✓ treemap.png');

// ── 6. Reactions tab ─────────────────────────────────────────────────────────
const reactionsTab = await page.$$eval('button', btns => {
  const b = btns.find(b => b.textContent.trim() === 'Reactions');
  if (b) { b.click(); return true; }
  return false;
});
await delay(800);
await page.screenshot({ path: `${OUT}/reactions.png` });
console.log('✓ reactions.png');

// ── 7. Maps tab ───────────────────────────────────────────────────────────────
const mapsTab = await page.$$eval('button', btns => {
  const b = btns.find(b => b.textContent.trim() === 'Maps');
  if (b) { b.click(); return true; }
  return false;
});
await delay(1200);
await page.screenshot({ path: `${OUT}/maps.png` });
console.log('✓ maps.png');

// ── 8. Header close-up (showing MetaboViz branding) ──────────────────────────
// Go back to pathways for a clean full header shot
const pathwaysTab = await page.$$eval('button', btns => {
  const b = btns.find(b => b.textContent.trim() === 'Pathways');
  if (b) { b.click(); return true; }
  return false;
});
await delay(600);
await page.screenshot({ path: `${OUT}/header.png` });
console.log('✓ header.png');

await browser.close();
console.log('\nAll screenshots saved to docs/screenshots/');
