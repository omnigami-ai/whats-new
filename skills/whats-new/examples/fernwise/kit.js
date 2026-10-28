// omnigami template kit. Every template folder carries its own copy of this
// file, so a template never loads anything from outside its folder.
// Everything here is a pure function of its arguments except the loaders,
// which a template only calls from prepare().
// Loaded as a classic script (a sandboxed iframe has no origin, so modules
// would need CORS); it defines window.kit.

(() => {

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ramp = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
const smooth = (p) => p * p * (3 - 2 * p);

// Closed-form damped spring, 0 → 1. Pure function of time.
function spring(t, k = 170, d = 26) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k), z = d / (2 * w0);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

// A value with several targets: one spring per change, each from its own time.
// keys: [[time, value], ...] sorted by time.
function track(t, keys, k = 170, d = 26) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
  return v;
}

// Named spring feels, from the house rules.
const SNAPPY = [320, 30], DEFAULT = [170, 26], HEAVY = [120, 24];

// Seeded noise (mulberry32). Never Math.random.
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- loading (prepare() only) ----------

const imageCache = new Map();
function loadImage(src) {
  if (typeof src !== 'string') return Promise.resolve(src); // ImageBitmap or element handed in by the player
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // keeps the canvas exportable inside the sandbox
      img.onload = () => img.decode().then(() => resolve(img), () => resolve(img));
      img.onerror = () => reject(new Error(`Could not load image ${src}`));
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

const fontCache = new Map();
function loadFont(family, source, descriptors = {}) {
  const key = `${family}|${JSON.stringify(descriptors)}|${typeof source === 'string' ? source : 'buffer'}`;
  if (!fontCache.has(key)) {
    const face = new FontFace(family, typeof source === 'string' ? `url(${source})` : source, descriptors);
    fontCache.set(key, face.load().then((loaded) => { document.fonts.add(loaded); return loaded; }));
  }
  return fontCache.get(key);
}

// Image field values are either a src string or { src, focus: [x, y] }.
const imageSrc = (value) => (value && typeof value === 'object' && 'src' in value ? value.src : value);
const imageFocus = (value, fallback = [0.5, 0.5]) => (value && typeof value === 'object' && value.focus) || fallback;

// ---------- text ----------

// "Your menu, *never out of date.*" → words, each flagged when inside *…*.
function parseEmphasis(text) {
  const words = [];
  let em = false;
  for (const raw of String(text).trim().split(/\s+/)) {
    if (!raw) continue;
    let w = raw;
    let open = false, close = false;
    if (w.startsWith('*')) { open = true; w = w.slice(1); }
    if (w.endsWith('*')) { close = true; w = w.slice(0, -1); }
    if (open) em = true;
    if (w) words.push({ text: w, em });
    if (close) em = false;
  }
  return words;
}

const measureCache = new Map();
function measure(ctx, font, text) {
  const key = font + '\u0000' + text;
  let w = measureCache.get(key);
  if (w === undefined) { ctx.font = font; w = ctx.measureText(text).width; measureCache.set(key, w); }
  return w;
}

// Fit words into a box: the largest size between min and max at which the text
// wraps into at most maxLines lines within maxWidth (and maxHeight, if given).
// fontFor(size, em) returns a canvas font string. Returns the laid-out lines,
// each word with its x offset. balance narrows the measure so lines come out
// even, and prefers a slightly smaller size to a single word on the last line.
// Results are cached: the same text in the same box lays out once.
const fitCache = new Map();
function fitText(ctx, opts) {
  const { text, fontFor, maxWidth, maxHeight = Infinity, maxLines = 1, maxSize, minSize = 8, lineHeight = 1.1, tracking = 0, balance = false } = opts;
  const key = [JSON.stringify(text), fontFor(100, false), fontFor(100, true), maxWidth, maxHeight, maxLines, maxSize, minSize, lineHeight, tracking, balance].join('|');
  const cached = fitCache.get(key);
  if (cached) return cached;

  const words = Array.isArray(text) ? text : parseEmphasis(text);
  const layoutAt = (size, width) => {
    const space = measure(ctx, fontFor(size, false), ' ');
    const lines = [];
    let line = [], x = 0;
    for (const word of words) {
      const w = measure(ctx, fontFor(size, word.em), word.text) + tracking * size * word.text.length;
      const gap = line.length ? space : 0;
      if (line.length && x + gap + w > width) { lines.push({ words: line, width: x }); line = []; x = 0; }
      const at = line.length ? x + space : 0;
      line.push({ ...word, x: at, width: w });
      x = at + w;
    }
    if (line.length) lines.push({ words: line, width: x });
    return lines;
  };
  const fits = (size) => {
    const lines = layoutAt(size, maxWidth);
    const ok = lines.length <= maxLines && lines.every((l) => l.width <= maxWidth + 0.5) && lines.length * size * lineHeight <= maxHeight;
    return ok ? lines : null;
  };
  const widest = (lines) => Math.max(0, ...lines.map((l) => l.width));
  const orphaned = (lines) => lines.length > 1 && lines[lines.length - 1].words.length === 1 && words.length > lines.length;
  // narrow the measure as far as possible without adding a line
  const balanced = (size, lines) => {
    const n = lines.length;
    let lo = widest(lines) * 0.5, hi = widest(lines), keep = lines;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const next = layoutAt(size, mid);
      if (next.length <= n && next.every((l) => l.width <= mid + 0.5)) { keep = next; hi = mid; } else lo = mid;
    }
    return keep;
  };

  let best = null;
  const top = fits(maxSize);
  if (top) best = { size: maxSize, lines: top };
  else {
    let lo = minSize, hi = maxSize;
    for (let i = 0; i < 14; i++) { // binary search on size
      const mid = (lo + hi) / 2;
      const lines = fits(mid);
      if (lines) { best = { size: mid, lines }; lo = mid; } else hi = mid;
    }
    if (!best) best = { size: minSize, lines: layoutAt(minSize, maxWidth) };
  }
  if (balance && best.lines.length > 1) {
    best.lines = balanced(best.size, best.lines);
    // a lone last word: step the size down a little (at most about 20%) looking for a better break
    if (orphaned(best.lines)) {
      for (let k = 1, size = best.size * 0.97; k <= 7 && size >= minSize; k++, size *= 0.97) {
        const lines = fits(size);
        if (lines && !orphaned(lines)) { best = { size, lines: balanced(size, lines) }; break; }
      }
    }
  }
  best.lineHeight = best.size * lineHeight;
  best.height = best.lines.length * best.lineHeight;
  best.width = widest(best.lines);
  if (fitCache.size > 4000) fitCache.clear();
  fitCache.set(key, best);
  return best;
}

// Font size at which one line of text spans exactly `width`.
// fontFor(size) returns a canvas font string; a width keyword such as
// 'extra-condensed' or 'expanded' can lead it ('expanded 900 100px Archivo').
function sizeToWidth(ctx, text, fontFor, width) {
  return (100 * width) / measure(ctx, fontFor(100), text);
}

// Cap height and descender as fractions of the font size, measured once per font.
const capCache = new Map();
function capRatio(ctx, fontFor) {
  const key = fontFor(100);
  let r = capCache.get(key);
  if (!r) {
    ctx.font = key;
    const m = ctx.measureText('H');
    r = m.actualBoundingBoxAscent / 100;
    capCache.set(key, r);
  }
  return r;
}
// Font size whose capitals are `capHeight` tall.
const sizeForCap = (ctx, fontFor, capHeight) => capHeight / capRatio(ctx, fontFor);

// A simple camera for flat 3D planes: project [x, y, z] (z away from the
// viewer) to screen, around centre (cx, cy) with focal length f.
function project([x, y, z], { cx, cy, f }) {
  const s = f / (f + z);
  return [cx + x * s, cy + y * s, s];
}

const easeOutExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

// ---------- drawing ----------

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw img to cover the box, keeping focus = [fx, fy] (0..1 of the image) as
// close to the box centre as the image edges allow. zoom > 1 crops tighter.
function drawCover(ctx, img, x, y, w, h, focus = [0.5, 0.5], zoom = 1) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const sw = w / scale, sh = h / scale;
  const sx = clamp(focus[0] * iw - sw / 2, 0, iw - sw);
  const sy = clamp(focus[1] * ih - sh / 2, 0, ih - sh);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  // where the focus point landed, for cursors and highlights
  return { x: x + (focus[0] * iw - sx) * scale, y: y + (focus[1] * ih - sy) * scale, scale };
}

// Largest box of the image's aspect (clamped) that fits the region.
function fitBox(region, aspect, minAspect = 0.45, maxAspect = 2.2) {
  const a = clamp(aspect, minAspect, maxAspect);
  let w = region.w, h = w / a;
  if (h > region.h) { h = region.h; w = h * a; }
  return { x: region.x + (region.w - w) / 2, y: region.y + (region.h - h) / 2, w, h };
}

// Relative luminance of #rrggbb, for picking legible ink on a colour.
function luminance(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// ---------- house motion (additive; legacy films keep their own choreography) ----------

const out = (p) => 1 - (1 - clamp(p)) ** 5;
const snap = (p) => easeOutExpo(clamp(p));
const inOut = (p) => (1 - Math.cos(Math.PI * clamp(p))) / 2;

// Critical damping, analytically normalised to land at exactly dur. No
// integration, accumulated velocity or overshoot, even when seeking backwards.
function settle(t, dur = 0.5) {
  if (dur <= 0) return t < 0 ? 0 : 1;
  const p = clamp(t / dur), w = 8;
  return clamp((1 - (1 + w * p) * Math.exp(-w * p)) / (1 - (1 + w) * Math.exp(-w)));
}

const shortSide = (ctx) => Math.min(ctx.canvas.width, ctx.canvas.height);
const point = (p, fallback) => ({ x: p?.x ?? fallback.x, y: p?.y ?? fallback.y });
function arcPoint(from, to, p, curve = 0.15, c1, c2) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = c1 || { x: from.x + dx / 3 - dy * curve, y: from.y + dy / 3 + dx * curve };
  const b = c2 || { x: from.x + dx * 2 / 3 - dy * curve, y: from.y + dy * 2 / 3 + dx * curve };
  const q = 1 - p;
  return { x: q ** 3 * from.x + 3 * q * q * p * a.x + 3 * q * p * p * b.x + p ** 3 * to.x,
    y: q ** 3 * from.y + 3 * q * q * p * a.y + 3 * q * p * p * b.y + p ** 3 * to.y };
}

// Paths are absolute-time segments {at, from?, to?, dur?, curve?, c1?, c2?, exit?}.
// A numeric press (or array of numbers) is the UI hit time, not an animation
// progress. Return pressed on that very frame so the UI can share the clock.
function drawCursor(ctx, { x = ctx.canvas.width / 2, y = ctx.canvas.height / 2, t = 0, path, press = [], theme = {} } = {}) {
  const S = shortSide(ctx), target = { x, y };
  const raw = path ? (Array.isArray(path) ? path : [path]) : [{ at: 0, from: { x: ctx.canvas.width + 0.06 * S, y: y + 0.15 * S }, to: target }];
  let previous = target;
  const segments = raw.map((segment) => {
    const from = point(segment.from, previous);
    const drift = 0.02 * S * Math.SQRT1_2;
    const to = point(segment.to, segment.exit ? { x: from.x + drift, y: from.y + drift } : target);
    const dur = segment.dur ?? (segment.exit ? 0.2 : lerp(0.45, 0.7, clamp(Math.hypot(to.x - from.x, to.y - from.y) / S)));
    if (!(dur > 0)) throw new RangeError('Cursor path durations must be positive');
    previous = to;
    return { ...segment, at: segment.at ?? 0, from, to, dur };
  });
  const hits = (Array.isArray(press) ? press : [press]).map((hit) => typeof hit === 'number' ? hit : hit.at);
  const first = segments[0];
  let position = first ? first.from : target, alpha = first ? ramp(t, first.at, first.at + 0.12) : 1;
  let moving = false, idleAt = first?.at ?? 0, nextAt = Infinity;
  for (const segment of segments) {
    if (t < segment.at) { nextAt = segment.at; break; }
    const p = ramp(t, segment.at, segment.at + segment.dur);
    position = arcPoint(segment.from, segment.to, out(p), segment.curve ?? 0.15, segment.c1, segment.c2);
    moving = p < 1;
    idleAt = segment.at + segment.dur;
    if (segment.exit) alpha *= 1 - ramp(t, segment.at, segment.at + Math.min(0.2, segment.dur));
  }
  let scale = 1, pressed = false, quiet = 1;
  for (const hit of hits) {
    const dt = t - hit;
    // Arrive by hit - .08: this interval then brakes the hover drift too.
    quiet = Math.min(quiet, clamp(Math.abs(dt) / 0.08));
    if (dt >= 0 && dt < 0.18) {
      pressed ||= dt < 0.06;
      scale = Math.min(scale, dt < 0.06 ? lerp(1, 0.86, out(dt / 0.06)) : lerp(0.86, 1, settle(dt - 0.06, 0.12)));
    }
  }
  const idle = moving ? 0 : out(ramp(t, idleAt, idleAt + 0.2)) * out(clamp((nextAt - t) / 0.08)) * quiet;
  const seed = theme.seed ?? 1;
  const px = position.x + idle * 0.002 * S * Math.sin((t - idleAt) * 1.7 + seed * 2.399);
  const py = position.y + idle * 0.002 * S * Math.sin((t - idleAt) * 1.3 + seed * 1.618);
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (const hit of hits) {
    const p = (t - hit) / 0.35;
    if (p < 0 || p >= 1) continue;
    let tip = first?.from ?? target;
    for (const segment of segments) {
      if (hit < segment.at) break;
      tip = arcPoint(segment.from, segment.to, out(ramp(hit, segment.at, segment.at + segment.dur)), segment.curve ?? 0.15, segment.c1, segment.c2);
    }
    ctx.save();
    ctx.globalAlpha *= 0.35 * (1 - p);
    ctx.strokeStyle = theme.accent ?? '#2f5bff';
    ctx.lineWidth = 0.004 * S * (1 - p);
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 0.06 * S * out(p), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.translate(px, py); ctx.scale(scale, scale);
  ctx.shadowColor = 'rgb(0 0 0 / 25%)'; ctx.shadowBlur = 0.012 * S; ctx.shadowOffsetY = 0.004 * S;
  // Tip at the origin; the long left edge and short tail read as an arrow
  // rather than the tiny triangle used by the older films.
  const h = 0.055 * S;
  ctx.beginPath();
  for (const [i, [u, v]] of [[0, 0], [0, 0.83], [0.22, 0.65], [0.39, 1], [0.57, 0.91], [0.4, 0.57], [0.72, 0.57]].entries()) {
    if (i) ctx.lineTo(u * h, v * h); else ctx.moveTo(u * h, v * h);
  }
  ctx.closePath(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.004 * S;
  ctx.strokeStyle = theme.stroke ?? '#ffffff'; ctx.fillStyle = theme.fill ?? '#191b1d';
  ctx.stroke();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fill(); ctx.restore();
  return { x: px, y: py, alpha, scale, pressed };
}

// drawMark(ctx, {size, fg, t, progress}) draws about local (0,0). A lockup's
// measured wordmark width determines the exact leftward shift of the mark.
function markReveal(ctx, { t = 0, at = 0, cx = ctx.canvas.width / 2, cy = ctx.canvas.height / 2,
  size = 0.16 * shortSide(ctx), shape = 'squircle', bg = '#2f5bff', fg = '#ffffff', drawMark = () => {}, lockup } = {}) {
  const S = shortSide(ctx), elapsed = t - at;
  const container = settle(elapsed, 0.5), mark = settle(elapsed - 0.12, 0.3);
  const fill = typeof bg === 'string' ? { from: '#202225', to: bg } : bg;
  const lockAt = lockup?.at ?? at + 0.75, lockDur = lockup?.dur ?? 0.5;
  const slide = lockup ? settle(t - lockAt, lockDur) : 0;
  const mask = lockup ? out((t - lockAt) / lockDur) : 0;
  const gap = lockup?.gap ?? 0.035 * S;
  const font = lockup?.font ?? `600 ${0.095 * S}px sans-serif`;
  ctx.save(); ctx.font = font;
  const width = lockup ? (lockup.width ?? ctx.measureText(lockup.text ?? '').width) : 0;
  const shift = lockup ? (gap + width) / 2 : 0;
  const line = lockup?.line ?? '';
  const lineProgress = line ? settle(t - lockAt - 0.15, 0.35) : 0;
  const finished = lockup ? Math.max(lockAt + lockDur, line ? lockAt + 0.5 : 0) : at + 0.5;
  const holdEnd = finished + Math.min(1.2, Math.max(0, lockup?.hold ?? 1.2));
  const push = 1 + 0.018 * out(ramp(t, finished, Math.max(finished + 0.001, holdEnd)));
  ctx.translate(cx, cy); ctx.scale(push, push);
  const markX = -shift * slide;
  const extent = lerp(0.02 * S, size, container);
  const radius = lerp(extent / 2, shape === 'circle' ? extent / 2 : extent * 0.23, container);
  if (elapsed > -0.12) {
    ctx.save(); ctx.translate(markX, 0);
    ctx.globalAlpha *= out((elapsed + 0.12) / 0.12);
    ctx.save();
    if (shape === 'none') ctx.globalAlpha *= 1 - mark;
    roundRect(ctx, -extent / 2, -extent / 2, extent, extent, radius);
    // Mix the colour, then fill once. Painting two antialiased silhouettes
    // would leave the seed colour as a one-pixel fringe around the container.
    ctx.fillStyle = `color-mix(in srgb, ${fill.from ?? '#202225'} ${(1 - container) * 100}%, ${fill.to ?? '#2f5bff'} ${container * 100}%)`;
    ctx.fill();
    ctx.restore();
    // The mark and its expanding container share the same filled footprint.
    roundRect(ctx, -extent / 2, -extent / 2, extent, extent, radius); ctx.clip();
    ctx.globalAlpha *= mark;
    const zoom = lerp(0.82, 1, mark); ctx.scale(zoom, zoom);
    ctx.fillStyle = fg; drawMark(ctx, { size, fg, t, progress: mark });
    ctx.restore();
  }
  if (lockup && mask > 0) {
    ctx.save();
    const left = markX + size / 2 + gap;
    ctx.beginPath(); ctx.rect(left, -size, width * mask, size * 2); ctx.clip();
    ctx.font = font; ctx.fillStyle = lockup.color ?? fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(lockup.text ?? '', left, 0); ctx.restore();
    if (line && lineProgress > 0) {
      ctx.save(); ctx.globalAlpha *= lineProgress;
      ctx.font = lockup.lineFont ?? `400 ${0.032 * S}px sans-serif`;
      ctx.fillStyle = lockup.lineColor ?? lockup.color ?? fg;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(line, 0, size * 0.82 + 0.02 * S * (1 - lineProgress)); ctx.restore();
    }
  }
  ctx.restore();
  return { x: cx + markX * push, y: cy, size: extent * push, radius: radius * push, mark, slide, push, finished, holdEnd };
}

// A vector clip, never a stroked circle, blurred border or grey overlay.
// t is elapsed seconds. A rounded-rect source morphs for four frames before
// radial growth. Log-radius quad-out bounds growth at <= 1.35 per frame.
function iris(ctx, { t = 0, from, to = {}, feather = 0 } = {}) {
  const S = shortSide(ctx), fps = to.fps ?? 60;
  const start = point(from, { x: ctx.canvas.width / 2, y: ctx.canvas.height / 2 });
  const end = point(to, start);
  const rect = from?.w > 0 && from?.h > 0;
  const r0 = Math.max(0.5, rect ? Math.hypot(from.w, from.h) / 2 : (from?.r ?? 0.01 * S));
  const edge = clamp(feather, 0, 0.003 * S);
  const corner = Math.max(...[[0, 0], [ctx.canvas.width, 0], [0, ctx.canvas.height], [ctx.canvas.width, ctx.canvas.height]]
    .map(([x, y]) => Math.hypot(x - end.x, y - end.y)));
  const r1 = Math.max(r0, to.r ?? 0, corner + Math.max(1, edge));
  const morphDur = rect ? 4 / fps : 0;
  const minimum = 2 * Math.log(r1 / r0) / (fps * Math.log(1.35));
  const dur = to.dur ?? Math.max(0.75, morphDur + minimum);
  if (!(fps > 0) || !(dur > morphDur) || dur - morphDur + 1e-9 < minimum) {
    throw new RangeError(`Iris duration must be at least ${(morphDur + minimum).toFixed(4)}s at ${fps} fps (1.35x radius limit)`);
  }
  const morph = out(ramp(t, 0, morphDur || 1));
  const p = clamp((t - morphDur) / (dur - morphDur));
  const growth = 1 - (1 - p) ** 2;
  const r = r0 * Math.exp(Math.log(r1 / r0) * growth);
  const x = lerp(start.x, end.x, out(clamp(t / dur))), y = lerp(start.y, end.y, out(clamp(t / dur)));
  if (rect && t < morphDur) {
    const w = lerp(from.w, 2 * r0, morph), h = lerp(from.h, 2 * r0, morph);
    roundRect(ctx, x - w / 2, y - h / 2, w, h, lerp(from.radius ?? 0, r0, morph));
  } else {
    // Use the same arcTo construction as the source tiles/containers, including
    // for circles, so the subpixel edge does not change at the handoff.
    roundRect(ctx, x - r, y - r, 2 * r, 2 * r, r);
  }
  ctx.clip();
  return { x, y, r, dur, done: t >= dur };
}

// Geometry only: the caller draws the returned states. The final tile becomes
// a filled dot; earlier tiles shrink into it. No input object is mutated.
function converge(items, t, { to, dur = 0.6 } = {}) {
  if (!(dur > 0)) throw new RangeError('Converge duration must be positive');
  const last = items.length - 1;
  const states = items.map((item, i) => {
    const at = i * 0.03, p = out((t - at) / dur);
    const position = arcPoint(item, to, p, item.curve ?? (i % 2 ? -0.15 : 0.15));
    const size = item.size ?? Math.max(item.w ?? 1, item.h ?? 1);
    const endScale = i === last ? (to.size ?? size * 0.12) / size : 0;
    const scale = lerp(item.scale ?? 1, endScale, p);
    const w = i === last ? lerp((item.w ?? size) * (item.scale ?? 1), to.size ?? size * 0.12, p) : (item.w ?? size) * scale;
    const h = i === last ? lerp((item.h ?? size) * (item.scale ?? 1), to.size ?? size * 0.12, p) : (item.h ?? size) * scale;
    return { ...item, ...position, scale, w, h, radius: lerp((item.radius ?? size * 0.2) * scale, Math.min(w, h) / 2, p), progress: p };
  });
  const tail = states[last];
  const footprint = tail ? (tail.progress === 1 && Math.abs(tail.w - tail.h) < 1e-6
    ? { x: tail.x, y: tail.y, r: tail.w / 2 }
    : { x: tail.x, y: tail.y, w: tail.w, h: tail.h, r: Math.hypot(tail.w, tail.h) / 2, radius: tail.radius }) : null;
  return { items: states, footprint, end: Math.max(0, last * 0.03) + dur, done: t >= Math.max(0, last * 0.03) + dur };
}

const motion = { out, settle, snap, inOut, drawCursor, markReveal, iris, converge };

window.kit = { clamp, lerp, ramp, smooth, spring, track, SNAPPY, DEFAULT, HEAVY, rng, loadImage, loadFont, imageSrc, imageFocus, parseEmphasis, measure, fitText, sizeToWidth, capRatio, sizeForCap, project, easeOutExpo, easeInOutCubic, roundRect, drawCover, fitBox, luminance, motion };

// Inside a player's sandboxed iframe the page can't reach window.template, so
// it drives the film by message: { omni: 'load', values } prepares it and is
// answered with { omni: 'ready', … }; { omni: 'seek', t, values } paints a frame.
if (window.parent !== window) {
  window.addEventListener('message', async (e) => {
    const d = e.data, T = window.template;
    if (e.source !== window.parent || !d || typeof d.omni !== 'string' || !T) return;
    const values = { ...T.defaults(), ...(d.values || {}) };
    try {
      if (d.omni === 'load') {
        await T.prepare(values);
        window.parent.postMessage({ omni: 'ready', duration: T.duration, fps: T.fps, sizes: Object.keys(T.sizes || {}), fields: T.fields || [], states: T.states || [], defaults: T.defaults() }, '*');
      } else if (d.omni === 'seek') T.seek(d.t, values);
    } catch (err) {
      window.parent.postMessage({ omni: 'error', message: String(err && err.message || err) }, '*');
    }
  });
}
})();
