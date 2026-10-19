// Capture a product's real screens, in the states a film shows, from a plan:
//
//   node scripts/screens.mjs <plan.json> <out-dir>
//
// A plan is JSON:
//   {
//     "url": "https://product.example/page",
//     "viewport": "desktop" | "mobile" | [width, height],   desktop 1440 × 900, mobile a 390 × 844 phone
//     "ready": "selector",          wait for it after loading (optional)
//     "init": "js",                 run after loading, e.g. to hold an animation still (optional)
//     "hide": ["selector", ...],    hidden while capturing, e.g. a video the film composites itself
//     "rects": { "name": "selector", "names": "selector*" },  page rects to record; * records every match
//     "steps": [
//       { "rects": "state" },                               record the rects under this state's name
//       { "capture": "name", "full": true, "scale": 2 },    the whole page
//       { "capture": "name", "around": "selector", "nth": 0, "pad": 40, "scale": 4 },  a region
//       { "click": "selector", "nth": 0, "count": 1 },      count 3 selects a field's text
//       { "type": "selector", "text": "words", "capture": "name", "around": "selector", "pad": 16, "scale": 4 },
//                                                           types a letter at a time, capturing name-00 … name-NN
//       { "eval": "js" }, { "wait": 400 }, { "reload": true }
//       { "tap": [x, y], "count": 1 }                      a mouse click at a viewport point (canvas apps)
//       { "drag": [[x1, y1], [x2, y2]], "capture": "name", "frames": 6, "full": true, "scale": 2 }
//                                                           a mouse drag; with capture, name-00 … name-NN along the way
//       { "press": "Enter" }, { "keys": "text" }            keyboard, into whatever has focus
//     ]
//   }
// Writes WebP captures and screens.json: each capture's file, scale and page rect (CSS px),
// the rects of every state, and the text typed into each typed capture. Animations,
// transitions and the caret are switched off, so every capture is still.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { requireChrome, chromeArgs } from './chrome.mjs';

const [planFile, outArg] = process.argv.slice(2);
if (!planFile || !outArg) { console.error('usage: node scripts/screens.mjs <plan.json> <out-dir>'); process.exit(1); }
const plan = JSON.parse(await readFile(planFile, 'utf8'));
const out = path.resolve(outArg);
await mkdir(out, { recursive: true });

const PRESETS = { desktop: [1440, 900, false], mobile: [390, 844, true] };
const [vw, vh, mobile] = Array.isArray(plan.viewport) ? [...plan.viewport, false] : PRESETS[plan.viewport || 'desktop'];
const view = (scale) => ({ width: vw, height: vh, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const manifest = { url: plan.url, viewport: [vw, vh], captures: {}, rects: {}, typed: {} };

const browser = await puppeteer.launch({ executablePath: requireChrome(), headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars', ...chromeArgs()] });
const page = await browser.newPage();

async function load() {
  await page.setViewport(view(2));
  await page.goto(plan.url, { waitUntil: 'networkidle0', timeout: 60000 });
  if (plan.ready) await page.waitForSelector(plan.ready, { timeout: 30000 });
  await page.addStyleTag({ content: `
    ${(plan.hide || []).map((s) => `${s} { visibility: hidden !important; }`).join('\n')}
    *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
  ` });
  if (plan.init) await page.evaluate(plan.init);
  await settle();
}
// a selector's page rect in CSS px: [x, y, w, h]
const rectOf = (selector, nth = 0) => page.evaluate((selector, nth) => {
  const el = document.querySelectorAll(selector)[nth];
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return [b.left + scrollX, b.top + scrollY, b.width, b.height].map((v) => Math.round(v * 100) / 100);
}, selector, nth);
async function rects(state) {
  manifest.rects[state] = await page.evaluate((spec) => {
    const r = (el) => { const b = el.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height].map((v) => Math.round(v * 100) / 100); };
    const out = { page: [0, 0, document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
    for (const [name, sel] of Object.entries(spec)) {
      if (sel.endsWith('*')) out[name] = [...document.querySelectorAll(sel.slice(0, -1))].map(r);
      else { const el = document.querySelector(sel); out[name] = el ? r(el) : null; }
    }
    return out;
  }, plan.rects || {});
}
async function capture(name, step) {
  const scale = step.scale || 2;
  let clip = null;
  if (!step.full) {
    const r = step.rect || await rectOf(step.around, step.nth || 0);
    if (!r) throw new Error(`capture ${name}: nothing matches ${step.around}`);
    const p = step.pad ?? 0;
    clip = { x: Math.max(0, r[0] - p), y: Math.max(0, r[1] - p), width: r[2] + 2 * p, height: r[3] + 2 * p };
  }
  await page.setViewport(view(scale));
  await settle(250);
  const file = `${name}@${scale}.webp`;
  const buffer = await page.screenshot({ type: 'webp', quality: 92, ...(clip ? { clip, captureBeyondViewport: true } : { fullPage: true }) });
  await writeFile(path.join(out, file), buffer);
  const pageRect = clip ? [clip.x, clip.y, clip.width, clip.height] : await page.evaluate(() => [0, 0, document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  manifest.captures[name] = { file, scale, rect: pageRect };
  console.log(file);
}

await load();
for (const step of plan.steps) {
  if (step.rects) await rects(step.rects);
  else if (step.type) {
    const text = step.text, name = step.capture;
    manifest.typed[name] = text;
    for (let i = 1; i <= text.length; i++) {
      await page.focus(step.type);
      await page.keyboard.type(text[i - 1]);
      await settle(120);
      if (name) await capture(`${name}-${String(i).padStart(2, '0')}`, step);
    }
  }
  else if (step.tap) { await page.mouse.click(step.tap[0], step.tap[1], { count: step.count || 1 }); await settle(step.settle ?? 350); }
  else if (step.press) { await page.keyboard.press(step.press); await settle(step.settle ?? 350); }
  else if (step.keys) { await page.keyboard.type(step.keys, { delay: 40 }); await settle(step.settle ?? 350); }
  else if (step.drag) {
    const [[x1, y1], [x2, y2]] = step.drag, n = step.capture ? (step.frames || 6) : 1;
    await page.mouse.move(x1, y1); await page.mouse.down();
    for (let i = 1; i <= n; i++) {
      const p = i / n;
      await page.mouse.move(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p, { steps: 4 });
      if (step.capture && i < n) { await settle(150); await capture(`${step.capture}-${String(i).padStart(2, '0')}`, step); }
    }
    await page.mouse.up(); await settle(step.settle ?? 350);
    if (step.capture) await capture(`${step.capture}-${String(n).padStart(2, '0')}`, step);
  }
  else if (step.capture) await capture(step.capture, step);
  else if (step.click) {
    const handles = await page.$$(step.click);
    const el = handles[step.nth || 0];
    if (!el) throw new Error(`click: nothing matches ${step.click}`);
    await el.click({ count: step.count || 1 });
    await settle(step.settle ?? 350);
  } else if (step.eval) { await page.evaluate(step.eval); await settle(); }
  else if (step.wait) await settle(step.wait);
  else if (step.reload) await load();
  else throw new Error(`unknown step ${JSON.stringify(step)}`);
}
await writeFile(path.join(out, 'screens.json'), JSON.stringify(manifest, null, 1) + '\n');
await browser.close();
console.log(`wrote ${path.join(path.relative(process.cwd(), out), 'screens.json')}`);
