// Capture a product's public page: screenshots, logo, colours, fonts and words,
// for a film's values.
//
//   node scripts/capture.mjs <url> <out-dir> [--pages url2,url3]
//
// Writes into <out-dir>:
//   desktop-<n>.png   1600×1000 viewport at 2×, the hero first, then the page in viewport-high sections
//   phone.png         390×844 at 3×
//   page-<k>-<n>.png  the same for each extra page in --pages
//   logo.png          the header logo on a transparent background, if one was found;
//                     logo-link.png (the whole home link) and logo.svg or logo-file.* when available.
//                     Automatic logo finding is approximate: look at them and choose.
//   fonts/            the web fonts the headline and body use, when the page serves them
//   brand.json        colours (most prominent first), fonts, words, and the list of files
//
// This is a public marketing page. Screens of the product itself (behind a sign-in)
// must come from the user: never invent them.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { requireChrome, chromeArgs } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const [url, outArg] = args;
if (!url || !outArg) { console.error('usage: node scripts/capture.mjs <url> <out-dir> [--pages url2,url3]'); process.exit(1); }
const out = path.resolve(outArg);
await mkdir(path.join(out, 'fonts'), { recursive: true });

const browser = await puppeteer.launch({ executablePath: requireChrome(), headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars', ...chromeArgs()] });
const brand = { url, files: [], colours: [], fonts: [], words: {} };
const cssTexts = new Map(); // stylesheet URL → text, for @font-face rules we can't read in the page
const fontBytes = new Map(); // font URL → bytes

async function open(target, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36');
  page.on('response', async (r) => {
    try {
      const type = r.request().resourceType();
      if (type === 'stylesheet' && r.ok()) cssTexts.set(r.url(), await r.text());
      if (type === 'font' && r.ok()) fontBytes.set(r.url(), await r.buffer());
    } catch { /* body unavailable */ }
  });
  await page.goto(target, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => console.error(`slow page, continuing: ${target}`));
  await dismissBanners(page);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  return page;
}

// Click away cookie and consent banners so they aren't in the screenshots.
async function dismissBanners(page) {
  await page.evaluate(() => {
    const words = /^(accept( all)?|allow( all)?|agree|i agree|got it|ok|okay|close|dismiss|no thanks)$/i;
    for (const b of document.querySelectorAll('button, [role="button"], a')) {
      if (words.test((b.textContent || '').trim()) && b.offsetParent) { b.click(); }
    }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
}

// Scroll through once so lazy content loads and scroll-triggered animations finish.
async function settle(page) {
  await page.evaluate(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < Math.min(document.body.scrollHeight, 12000); y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
}

async function sections(page, prefix, max) {
  const h = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 12000));
  const vh = page.viewport().height;
  const names = [];
  for (let i = 0, y = 0; i < max && y < h; i++, y += vh) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await new Promise((r) => setTimeout(r, 350));
    const file = `${prefix}-${i + 1}.png`;
    await page.screenshot({ path: path.join(out, file) });
    names.push(file);
  }
  await page.evaluate(() => scrollTo(0, 0));
  return names;
}

try {
  const desk = await open(url, { width: 1600, height: 1000, deviceScaleFactor: 2 });
  brand.files.push(...await sections(desk, 'desktop', 6));

  // logo: an image or svg in the header, or the first link home that holds one
  const logoBox = await desk.evaluate(() => {
    const scope = document.querySelector('header, nav, [role="banner"]') || document.body;
    // most specific first: the image itself, so a link's or header's background doesn't come with it
    const selectors = ['a[href="/"] svg', 'a[href="/"] img', 'img[alt*="logo" i]', 'img[class*="logo" i]', 'svg[class*="logo" i]', '[class*="logo" i] svg', '[class*="logo" i] img', 'a[href="/"]'];
    const cands = selectors.flatMap((sel) => [...scope.querySelectorAll(sel)]);
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 12 && r.top < 200 && r.width < 600) {
        el.setAttribute('data-omnigami-logo', '');
        const link = el.closest('a');
        let linkBox = null;
        if (link && link !== el) {
          link.setAttribute('data-omnigami-logo-link', '');
          const lr = link.getBoundingClientRect();
          linkBox = { x: lr.left, y: lr.top, width: lr.width, height: lr.height };
        }
        const svg = el.tagName.toLowerCase() === 'svg' ? el.outerHTML : null;
        const src = el.tagName.toLowerCase() === 'img' ? (el.currentSrc || el.src) : null;
        return { x: r.left, y: r.top, width: r.width, height: r.height, linkBox, svg, src };
      }
    }
    return null;
  });
  if (logoBox) {
    await desk.addStyleTag({ content: 'html,body{background:transparent!important} body *{visibility:hidden!important} [data-omnigami-logo],[data-omnigami-logo] *{visibility:visible!important}' });
    await desk.screenshot({ path: path.join(out, 'logo.png'), omitBackground: true, clip: { x: logoBox.x - 4, y: logoBox.y - 4, width: logoBox.width + 8, height: logoBox.height + 8 } });
    brand.files.push('logo.png');
    // the whole home link too (mark plus wordmark, when they are separate), and the logo's own file
    if (logoBox.linkBox) {
      await desk.addStyleTag({ content: '[data-omnigami-logo-link],[data-omnigami-logo-link] *{visibility:visible!important}' });
      const b = logoBox.linkBox;
      await desk.screenshot({ path: path.join(out, 'logo-link.png'), omitBackground: true, clip: { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 } });
      brand.files.push('logo-link.png');
    }
    if (logoBox.svg) {
      const svg = logoBox.svg.includes('xmlns=') ? logoBox.svg : logoBox.svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      await writeFile(path.join(out, 'logo.svg'), svg);
      brand.files.push('logo.svg');
    } else if (logoBox.src) {
      const res = await fetch(logoBox.src).catch(() => null);
      if (res && res.ok) {
        const ext = path.extname(new URL(logoBox.src).pathname) || '.png';
        await writeFile(path.join(out, `logo-file${ext}`), Buffer.from(await res.arrayBuffer()));
        brand.files.push(`logo-file${ext}`);
      }
    }
    await desk.reload({ waitUntil: 'networkidle2' }).catch(() => {});
    await dismissBanners(desk);
  }

  // colours, fonts and words, read from computed styles and the page's text
  const read = await desk.evaluate(() => {
    const hex = (c) => {
      const m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
      return '#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const seen = new Map();
    const add = (c, source, weight) => { const h = hex(c); if (!h) return; const e = seen.get(h) || { hex: h, sources: new Set(), weight: 0 }; e.sources.add(source); e.weight += weight; seen.set(h, e); };
    const cs = (el) => getComputedStyle(el);
    add(cs(document.body).backgroundColor, 'page', 50);
    add(cs(document.documentElement).backgroundColor, 'page', 30);
    add(cs(document.body).color, 'text', 30);
    const h1 = document.querySelector('h1');
    if (h1) add(cs(h1).color, 'heading', 40);
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      const r = el.getBoundingClientRect(); if (!r.width || r.top > 3000) continue;
      const s = cs(el);
      if (hex(s.backgroundColor)) add(s.backgroundColor, 'button', Math.min(40, (r.width * r.height) / 800));
      else add(s.color, 'link', 2);
    }
    for (const el of document.querySelectorAll('header, section, footer, main > div')) {
      const r = el.getBoundingClientRect(); if (r.height < 100 || r.top > 6000) continue;
      add(cs(el).backgroundColor, 'section', Math.min(30, (r.width * r.height) / 60000));
    }
    const first = (stack) => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
    // visible elements only (responsive variants are often hidden copies); innerText keeps line breaks as spaces
    const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const textOf = (sel, n) => [...new Set([...document.querySelectorAll(sel)].filter(visible).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 200))].slice(0, n);
    const metaOf = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content || '';
    return {
      colours: [...seen.values()].sort((a, b) => b.weight - a.weight).slice(0, 12).map((e) => ({ hex: e.hex, sources: [...e.sources] })),
      headingFont: h1 ? { family: first(cs(h1).fontFamily), weight: cs(h1).fontWeight, style: cs(h1).fontStyle } : null,
      bodyFont: { family: first(cs(document.body).fontFamily), weight: cs(document.body).fontWeight },
      words: {
        title: document.title, description: metaOf('description') || metaOf('og:description'), siteName: metaOf('og:site_name'),
        h1: textOf('h1', 2), h2: textOf('h2', 10), h3: textOf('h3', 12), buttons: [...new Set(textOf('a, button', 80).filter((t) => t.length <= 32))].slice(0, 20),
        paragraphs: textOf('main p, section p, header p', 12),
      },
      image: metaOf('og:image'),
    };
  });
  brand.colours = read.colours;
  brand.words = read.words;
  brand.ogImage = read.image || undefined;

  const phone = await open(url, { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.screenshot({ path: path.join(out, 'phone.png') });
  brand.files.push('phone.png');

  const pages = (opt('pages') || '').split(',').filter(Boolean);
  for (const [k, p] of pages.entries()) {
    const pg = await open(p, { width: 1600, height: 1000, deviceScaleFactor: 2 });
    brand.files.push(...await sections(pg, `page-${k + 1}`, 4));
  }

  // web fonts: match @font-face rules for the heading and body families to downloaded files
  const faces = [];
  for (const [cssUrl, text] of cssTexts) {
    for (const block of text.match(/@font-face\s*{[^}]*}/g) || []) {
      const family = block.match(/font-family:\s*["']?([^;"']+)["']?/)?.[1]?.trim();
      const weight = block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() || '400';
      const style = block.match(/font-style:\s*([^;]+)/)?.[1]?.trim() || 'normal';
      const src = [...block.matchAll(/url\(["']?([^)"']+)["']?\)/g)].map((m) => new URL(m[1], cssUrl).href);
      if (family) faces.push({ family, weight, style, src });
    }
  }
  const wanted = [read.headingFont?.family, read.bodyFont.family].filter(Boolean);
  const saved = new Set();
  for (const face of faces.filter((f) => wanted.includes(f.family))) {
    const hit = face.src.find((s) => fontBytes.has(s));
    if (!hit || saved.has(hit)) continue;
    saved.add(hit);
    const ext = path.extname(new URL(hit).pathname) || '.woff2';
    const file = `fonts/${face.family.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${face.weight.replace(/\s+/g, '-')}${face.style === 'italic' ? '-italic' : ''}${ext}`;
    await writeFile(path.join(out, file), fontBytes.get(hit));
    brand.fonts.push({ family: face.family, src: file, weight: face.weight, style: face.style });
  }
  brand.headingFont = read.headingFont;
  brand.bodyFont = read.bodyFont;
  brand.fontNote = brand.fonts.length
    ? 'Web fonts saved from the page. Use them only if the product owns or licenses them for this use; otherwise use the bundled faces.'
    : 'No web font files matched the heading or body family (system font, or served in a way we could not read). Use the closest bundled face.';

  await writeFile(path.join(out, 'brand.json'), JSON.stringify(brand, null, 2));
  console.log(`captured ${url}`);
  console.log(`  files: ${brand.files.join(', ')}`);
  console.log(`  colours: ${brand.colours.slice(0, 6).map((c) => `${c.hex} (${c.sources.join('/')})`).join(', ')}`);
  console.log(`  heading font: ${brand.headingFont?.family || 'none'}; body font: ${brand.bodyFont.family}; saved ${brand.fonts.length} font file(s)`);
  console.log(`  h1: ${brand.words.h1.join(' | ')}`);
  console.log(`  wrote ${path.join(out, 'brand.json')}`);
} catch (e) {
  console.error(`capture failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
