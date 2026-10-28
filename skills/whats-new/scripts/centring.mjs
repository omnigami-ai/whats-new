// Check that words and icons sit on their container's centre line: a label in a button, pill, chip, tag, badge or
// avatar is centred on its capitals, an icon on its box, never riding high (a plain line box centres the font's em box,
// which sits most faces 5–11 % of their size high).
//
//   node scripts/centring.mjs <plan.json | url> [more ...] [--origin http://localhost:8791] [--viewport 1512x982]
//                             [--no-crawl] [--limit 40]
//
// A capture plan (scripts/screens.mjs) gives its url, viewport and ready selector, and the routes its steps visit
// (every `location.hash = '#/…'`). --origin swaps the plan's scheme, host and port, for a product served elsewhere.
// From each page it also follows the app's own `#/` links, up to --limit pages in all. On every page it finds the small
// rounded things with a background or a border (at most 64 px tall) that hold one line of text or an icon, and
// measures, in CSS px:
//   the box's centre             its padding box (inside any border)
//   the text's capital centre    the baseline (where a zero-size inline-block set beside the text sits), less half
//                                the height of a capital H in the computed font
//   each icon's centre           svg, vector img (never a photo), and icon elements (.icon, .spin, i)
// As painted: Chrome snaps a box's edges and a line's baseline to whole CSS px, so a label a little high in the layout
// can paint a whole pixel high (measured against the pixels of a 4× capture), while one centred in the layout can paint
// up to half a pixel off. So it fails anything off by more than 0.25 px in the layout (a lean the CSS can fix), and notes
// anything centred in the layout that still paints more than 0.75 px off (its fractional position; move it to a whole
// pixel if it shows), each with both numbers, its page and its path. The exit code is 1 if anything fails. Icons beside
// a label on two lines are left alone: those are set to its first line on purpose.
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { requireChrome, chromeArgs } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes('--' + name);
const targets = args.filter((a, i) => !a.startsWith('--') && !['--origin', '--viewport', '--limit'].includes(args[i - 1]));
if (!targets.length) { console.error('usage: node scripts/centring.mjs <plan.json | url> [more ...] [--origin url] [--viewport WxH] [--no-crawl] [--limit 40]'); process.exit(1); }
const TOLERANCE = { layout: 0.25, painted: 0.75 }, LIMIT = Number(opt('limit', 40));
const PRESETS = { desktop: [1440, 900, false], mobile: [390, 844, true] };

// each target as { url, viewport, ready, routes }
async function site(target) {
  if (!target.endsWith('.json')) {
    const v = opt('viewport', null)?.split('x').map(Number);
    return { url: target, viewport: v ? [...v, false] : PRESETS.desktop, ready: null, routes: [] };
  }
  const plan = JSON.parse(await readFile(target, 'utf8'));
  const routes = [];
  for (const step of plan.steps || []) {
    const m = typeof step.eval === 'string' && step.eval.match(/location\.hash\s*=\s*['"]([^'"]*)['"]/);
    if (m && !routes.includes(m[1])) routes.push(m[1]);
  }
  const viewport = Array.isArray(plan.viewport) ? [...plan.viewport, false] : PRESETS[plan.viewport || 'desktop'];
  return { url: plan.url, viewport, ready: plan.ready || null, routes, init: plan.init };
}
const withOrigin = (url) => { const o = opt('origin', null); if (!o) return url; const u = new URL(url), n = new URL(o); u.protocol = n.protocol; u.host = n.host; return u.href; };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// runs in the page: every small rounded box with one line of text or an icon, and how far off centre each sits
function measure(tolerance) {
  const px = (v) => parseFloat(v) || 0;
  const shown = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
  const painted = (s) => {
    const bg = s.backgroundColor.match(/[\d.]+/g), border = ['Top', 'Right', 'Bottom', 'Left'].some((k) => px(s[`border${k}Width`]) > 0 && !/rgba\(.*,\s*0\)$|transparent/.test(s[`border${k}Color`]));
    return (bg && (bg.length < 4 || +bg[3] > 0)) || s.backgroundImage !== 'none' || border;
  };
  const rounded = (s) => ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].some((k) => px(s[`border${k}Radius`]) > 0);
  // an <img> is an icon only when it's vector art: a photo or cutout in a rounded frame sits where its picture wants it
  // (a plant anchored to its disc's foot), not on the centre line
  const vector = (el) => /\.svg(\?|#|$)/i.test(el.currentSrc || el.src || '') || /^data:image\/svg/i.test(el.src || '');
  const isIcon = (el) => el instanceof SVGSVGElement || (el.tagName === 'IMG' && vector(el)) || el.classList.contains('icon') || el.classList.contains('spin') || (el.tagName === 'I' && !el.textContent.trim());
  const boxes = [...document.querySelectorAll('body *')].filter((el) => {
    if (!(el instanceof HTMLElement) || isIcon(el) || !shown(el)) return false;
    const s = getComputedStyle(el), b = el.getBoundingClientRect();
    // a form field's box (a label over its input) sets its label at the top on purpose: not a one-line pill
    if (el.querySelector('input, textarea, select')) return false;
    return b.height <= 64 && rounded(s) && (painted(s) || el.matches('button, [role=button]'));
  });
  const owner = (node) => { for (let p = node.parentElement; p; p = p.parentElement) if (boxes.includes(p)) return p; return null; };
  const canvas = document.createElement('canvas').getContext('2d');
  const path = (el) => {
    const bits = [];
    for (let p = el; p && p !== document.body && bits.length < 3; p = p.parentElement) {
      let s = p.tagName.toLowerCase();
      if (p.id) { bits.unshift(`${s}#${p.id}`); break; }
      if (p.classList.length) s += '.' + [...p.classList].join('.');
      const sib = p.parentElement ? [...p.parentElement.children].filter((c) => c.tagName === p.tagName) : [];
      if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(p) + 1})`;
      bits.unshift(s);
    }
    return bits.join(' > ');
  };
  const out = [];
  for (const box of boxes) {
    const s = getComputedStyle(box), b = box.getBoundingClientRect();
    const top = b.top + px(s.borderTopWidth), bottom = b.bottom - px(s.borderBottomWidth), mid = (top + bottom) / 2;
    const paintedMid = (Math.round(b.top) + px(s.borderTopWidth) + Math.round(b.bottom) - px(s.borderBottomWidth)) / 2;
    const report = (what, layout, painted) => {
      const fails = Math.abs(layout) > tolerance.layout, notes = !fails && Math.abs(painted) > tolerance.painted;
      if (fails || notes) out.push({ path: path(box), what, fails, off: Math.round(painted * 100) / 100, layout: Math.round(layout * 100) / 100 });
    };
    const label = box.innerText.trim().replace(/\s+/g, ' ').slice(0, 40);
    // the text: its runs that belong to this box (not to a box inside it), on one line; the largest face leads
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), runs = [];
    for (let t; (t = walker.nextNode());) {
      if (!t.textContent.trim() || owner(t) !== box || !shown(t.parentElement)) continue;
      const r = document.createRange(); r.selectNodeContents(t);
      const rects = [...r.getClientRects()].filter((q) => q.width > 0);
      if (rects.length) runs.push({ t, rects, size: px(getComputedStyle(t.parentElement).fontSize) });
    }
    const lines = new Set(runs.flatMap((r) => r.rects.map((q) => Math.round(q.bottom))));
    const oneLine = [...lines].every((y) => Math.abs(y - [...lines][0]) <= 2);
    if (runs.length && oneLine) {
      const run = runs.reduce((a, r) => (r.size > a.size ? r : a)), cs = getComputedStyle(run.t.parentElement);
      canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const cap = canvas.measureText('H').actualBoundingBoxAscent;
      // the baseline, where a zero-size inline-block beside the text sits; wrapped in an inline box, which lays out as
      // the text's own anonymous box did, then put back. Custom tags with every property unset, so no page style
      // reaches them
      const wrap = document.createElement('centring-wrap'), probe = document.createElement('centring-probe');
      wrap.style.cssText = 'all:unset;display:inline';
      probe.style.cssText = 'all:unset;display:inline-block;width:0;height:0;vertical-align:baseline';
      run.t.replaceWith(wrap); wrap.append(run.t, probe);
      const baseline = probe.getBoundingClientRect().top;
      wrap.replaceWith(run.t);
      // > 0: the capitals sit high
      report(`text "${label}"`, mid - (baseline - cap / 2), paintedMid - (Math.round(baseline) - cap / 2));
    }
    // the icons: those that belong to this box
    for (const icon of oneLine ? box.querySelectorAll('svg, img, .icon, .spin, i') : []) {
      if (!isIcon(icon) || icon.closest('svg') !== icon && icon.closest('svg') || !shown(icon)) continue;
      let p = icon.parentElement; while (p && !boxes.includes(p)) p = p.parentElement;
      if (p !== box) continue;
      const r = icon.getBoundingClientRect();
      if (r.height >= bottom - top - 1) continue; // fills the box: nothing to centre
      report(`icon ${icon.tagName.toLowerCase()}${icon.classList.length ? '.' + [...icon.classList].join('.') : ''}${label ? ` beside "${label}"` : ''}`,
        mid - (r.top + r.bottom) / 2, paintedMid - (Math.round(r.top) + Math.round(r.bottom)) / 2);
    }
  }
  return { boxes: boxes.length, off: out };
}

const browser = await puppeteer.launch({ executablePath: requireChrome(), headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars', ...chromeArgs()] });
const page = await browser.newPage();
let flagged = 0, noted = 0, checked = 0;
for (const target of targets) {
  const s = await site(target), base = withOrigin(s.url);
  await page.setViewport({ width: s.viewport[0], height: s.viewport[1], deviceScaleFactor: 4, isMobile: s.viewport[2], hasTouch: s.viewport[2] });
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  if (s.ready) await page.waitForSelector(s.ready, { timeout: 30000 });
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  if (s.init) await page.evaluate(s.init);
  await fontsReady();
  const start = new URL(base).hash || '#/';
  const queue = [start, ...s.routes], seen = new Set();
  console.log(`${target}${opt('origin', null) ? ` at ${base}` : ''}`);
  while (queue.length && seen.size < LIMIT) {
    const route = queue.shift();
    if (seen.has(route)) continue;
    seen.add(route);
    await page.evaluate((h) => { if (location.hash !== h) location.hash = h; }, route);
    await settle(500);
    await fontsReady();
    const { boxes, off } = await page.evaluate(measure, TOLERANCE);
    const fails = off.filter((o) => o.fails).length;
    checked += boxes; flagged += fails; noted += off.length - fails;
    console.log(`  ${route}  ${boxes} boxes${fails ? `, ${fails} off centre` : ''}${off.length - fails ? `, ${off.length - fails} noted` : ''}`);
    for (const o of off) console.log(`    ${o.fails ? '' : 'note: '}${o.layout >= 0 ? `${o.layout} px high` : `${-o.layout} px low`} in the layout, ${Math.abs(o.off)} px ${o.off >= 0 ? 'high' : 'low'} as painted  ${o.what}  (${o.path})`);
    if (!flag('no-crawl')) {
      const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href')))].sort());
      for (const l of links) if (!seen.has(l) && !queue.includes(l)) queue.push(l);
    }
  }
}
await browser.close();
const notes = noted ? `; ${noted} centred in the layout but painted more than ${TOLERANCE.painted} px off (notes)` : '';
console.log(flagged ? `\n${flagged} of ${checked} off centre by more than ${TOLERANCE.layout} px${notes}` : `\ncentred: all ${checked} within ${TOLERANCE.layout} px${notes}`);
process.exit(flagged ? 1 : 0);

async function fontsReady() { await page.evaluate(() => document.fonts.ready.then(() => true)); }
