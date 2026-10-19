// Study a reference video frame by frame: the numbers a measured spec needs.
//
//   node scripts/study.mjs <video file | post URL> <out-dir> [options]
//     --every 0.5        a still every N seconds, tiled with their times into sheet.png (default 0.5)
//     --times 1.2,3.4    stills at these times instead
//     --from 0 --to 12   only this part of the video (stills, strips and the shot table)
//     --strip 4.2        12 consecutive frames from 4.2 s at the video's own frame rate, tiled with
//                        frame numbers into strip-4.2.png: how a move eases, overshoots and settles
//     --count 12         frames in a strip
//     --track 0.05,0.2,0.8,0.3@0-1.2
//                        follow what moves inside a region (x, y, w, h as fractions of the frame) from 0 to
//                        1.2 s: its box in every frame, into track-<t0>.json and printed (several: join with ;). The numbers of
//                        a move (start, end, overshoot, how fast it settles) for the spec
//     --cut 1            cut sensitivity: lower finds more cuts, higher fewer
//     --bpm 120          the tempo, when you know it (otherwise it is estimated from the sound and cuts)
//     --against <study.json> --shift 0 | --map 0:0,10.367:18.867
//                        compare this video's cuts with another study's (your film's MP4 against the
//                        reference): each cut, its partner and the difference in frames. shift: this
//                        video's time + shift = the other's time; map: as compare.mjs takes it
//
// A post URL (x.com/<handle>/status/<id>) is fetched through the public fxtwitter mirror
// (api.fxtwitter.com). It is unofficial and can fail: then ask the user for the video file.
//
// Writes into <out-dir>:
//   video.mp4, post.json   for a post: its video at the best size offered, and who posted it (the credit)
//   study.json   size, shape, fps, length; tempo; cuts; shots (start, end, length, beats); holds;
//                the content box and colours of every still
//   SHOTS.md     the shot table to complete by eye: what happens in each shot
//   sheet.png    the stills with their times; frames/ the stills at full size, for measuring
//
// Numbers only measure. Look at the stills and strips: your eyes decide what each shot does.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------- a labelled contact sheet, drawn by Chrome (ffmpeg's text filter is often missing) ----------
// rows: [{ title?, cells: [{ file, label }] }], each row's cells side by side at `width` px each
export async function sheet(rows, file, { width = 360, cols = 0 } = {}) {
  const { default: puppeteer } = await import('puppeteer-core');
  const { requireChrome, chromeArgs } = await import('./chrome.mjs');
  const n = cols || Math.max(...rows.map((r) => r.cells.length));
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #fff; font: 600 13px/1.2 ui-monospace, Menlo, monospace; color: #222; }
    .wrap { display: inline-block; padding: 4px; } .row { display: grid; grid-template-columns: repeat(${n}, ${width}px); gap: 4px; margin-bottom: 4px; }
    .t { grid-column: 1 / -1; padding: 6px 2px 0; color: #555; } figure { margin: 0; } img { width: ${width}px; display: block; }
    figcaption { padding: 3px 2px 5px; } .cut { color: #d4380d; }
  </style><div class="wrap">${rows.map((r) => {
    const cells = [];
    for (let i = 0; i < r.cells.length; i += n) cells.push(r.cells.slice(i, i + n));
    return (r.title ? `<div class="row"><div class="t">${esc(r.title)}</div></div>` : '') + cells.map((line) => `<div class="row">${line.map((c) => `<figure><img src="${pathToFileURL(c.file)}"><figcaption class="${c.cut ? 'cut' : ''}">${esc(c.label)}</figcaption></figure>`).join('')}</div>`).join('');
  }).join('')}</div>`;
  const page = path.join(path.dirname(path.resolve(file)), `.sheet-${process.pid}.html`);
  await writeFile(page, html);
  const browser = await puppeteer.launch({ executablePath: requireChrome(), headless: true, args: ['--allow-file-access-from-files', ...chromeArgs()] });
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: n * (width + 4) + 8, height: 200, deviceScaleFactor: 1 });
    await tab.goto(pathToFileURL(page).href, { waitUntil: 'load' });
    const el = await tab.$('.wrap');
    await el.screenshot({ path: path.resolve(file) });
  } finally { await browser.close(); await rm(page, { force: true }); }
}

const run = (cmd, argv, opts = {}) => new Promise((res, rej) => {
  const p = spawn(cmd, argv, { stdio: ['ignore', opts.capture ? 'pipe' : 'ignore', 'pipe'] });
  const out = [], err = [];
  if (opts.capture) p.stdout.on('data', (d) => (opts.onData ? opts.onData(d) : out.push(d)));
  p.stderr.on('data', (d) => err.push(d));
  p.on('close', (c) => (c ? rej(new Error(`${cmd} exited ${c}: ${Buffer.concat(err).toString().trim().split('\n').pop()}`)) : res(Buffer.concat(out))));
});

// ---------- fetching a post's video ----------
export async function fetchPost(url, dir) {
  const id = (String(url).match(/status(?:es)?\/(\d+)/) || [])[1];
  if (!id) throw new Error(`not a post URL: ${url}`);
  let post, res;
  try { res = await fetch(`https://api.fxtwitter.com/i/status/${id}`, { headers: { 'user-agent': 'omnigami-study' } }); }
  catch (err) { throw new Error(`could not reach the fxtwitter mirror (${err.message})`); }
  if (!res.ok) throw new Error(`the fxtwitter mirror has no such post (it answered ${res.status}): it may be private, deleted or not yet mirrored`);
  try { post = (await res.json()).tweet; } catch { post = null; }
  if (!post) throw new Error('the fxtwitter mirror answered, but not with a post');
  const video = post.media?.videos?.[0];
  if (!video) throw new Error('the post has no video');
  const mp4s = (video.formats || video.variants || []).filter((f) => f.container === 'mp4' || /\.mp4/.test(f.url || ''));
  const pick = mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || video;
  const got = await fetch(pick.url);
  if (!got.ok) throw new Error(`could not download the video (${got.status})`);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'video.mp4');
  await writeFile(file, Buffer.from(await got.arrayBuffer()));
  const credit = { url: post.url || url, id, handle: post.author?.screen_name, name: post.author?.name, posted: post.created_at, text: post.text, video: { width: video.width, height: video.height, duration: video.duration } };
  await writeFile(path.join(dir, 'post.json'), JSON.stringify(credit, null, 2) + '\n');
  return { file, credit };
}

// ---------- measuring ----------
export function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`${file} has no video stream`);
  const [a, b] = (v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate).split('/').map(Number);
  const rot = Math.abs(Number(v.tags?.rotate || v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation || 0)) % 180 === 90;
  const [w, h] = rot ? [v.height, v.width] : [v.width, v.height];
  return { width: w, height: h, fps: Math.round((a / (b || 1)) * 100) / 100, duration: Number(v.duration || j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio') };
}
export function shapeOf(w, h) {
  const r = w / h;
  for (const [name, v] of [['16:9', 16 / 9], ['1:1', 1], ['9:16', 9 / 16], ['4:5', 4 / 5], ['4:3', 4 / 3], ['3:4', 3 / 4], ['21:9', 21 / 9]]) if (Math.abs(r - v) / v < 0.03) return name;
  return `${w}:${h}`;
}

// every frame, small: its difference from the last (motion), kept whole only at the times asked for
async function frames(file, info, { from, to, keep }) {
  const AW = 128, AH = Math.max(2, Math.round((AW * info.height) / info.width / 2) * 2), size = AW * AH * 3;
  const fps = Math.min(60, info.fps || 30);
  const rows = [], kept = new Map();
  let buf = Buffer.alloc(0), prev = null, i = 0;
  const want = [...keep].sort((a, b) => a - b);
  const onFrame = (f) => {
    const t = from + i / fps;
    let diff = 0;
    const luma = new Float32Array(AW * AH);
    for (let p = 0, q = 0; p < size; p += 3, q++) luma[q] = 0.2126 * f[p] + 0.7152 * f[p + 1] + 0.0722 * f[p + 2];
    if (prev) { let s = 0; for (let q = 0; q < luma.length; q++) s += Math.abs(luma[q] - prev[q]); diff = s / luma.length; }
    // the background (the frame's commonest colour) and how much of the frame, inside a 5% margin, isn't it
    const bins = new Map();
    for (let p = 0; p < size; p += 3 * 5) { const key = ((f[p] >> 4) << 8) | ((f[p + 1] >> 4) << 4) | (f[p + 2] >> 4), b = bins.get(key) || [0, 0, 0, 0]; b[0]++; b[1] += f[p]; b[2] += f[p + 1]; b[3] += f[p + 2]; bins.set(key, b); }
    let top = null; for (const b of bins.values()) if (!top || b[0] > top[0]) top = b;
    const bg = [top[1] / top[0], top[2] / top[0], top[3] / top[0]].map(Math.round);
    let ink = 0, all = 0;
    const mx = Math.round(AW * 0.05), my = Math.round(AH * 0.05);
    for (let y = my; y < AH - my; y++) for (let x = mx; x < AW - mx; x++) { const p = (y * AW + x) * 3; all++; if (Math.abs(f[p] - bg[0]) + Math.abs(f[p + 1] - bg[1]) + Math.abs(f[p + 2] - bg[2]) > 60) ink++; }
    rows.push({ i, t: +t.toFixed(4), diff: +diff.toFixed(3), bg, ink: +(ink / all).toFixed(4) });
    for (const k of want) if (!kept.has(k) && Math.abs(k - t) <= 0.5 / fps + 1e-6) kept.set(k, Buffer.from(f));
    prev = luma; i++;
  };
  await run('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', file, '-t', String(to - from), '-vf', `fps=${fps},scale=${AW}:${AH}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    capture: true,
    onData: (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= size) { onFrame(buf.subarray(0, size)); buf = buf.subarray(size); } },
  });
  return { fps, rows, kept, AW, AH };
}

// cuts: a frame that differs far more than the frames around it; transitions: runs of heavy change
function findCuts(rows, fps, sensitivity) {
  const d = rows.map((r) => r.diff), n = d.length, cuts = [], moves = [];
  const sorted = d.slice(1).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)] || 0;
  const floor = Math.max(6, med * 8) * sensitivity;
  for (let i = 1; i < n; i++) {
    const around = [d[i - 2], d[i - 1], d[i + 1], d[i + 2]].filter((v) => v !== undefined);
    const local = around.reduce((a, b) => a + b, 0) / Math.max(1, around.length);
    if (d[i] > floor && d[i] > 3 * local * sensitivity) cuts.push(i);
  }
  // scene changes a motion film makes without a hard cut: the background changes colour (a flood or
  // a cut to another colour), or the frame empties and the next scene builds (counted where it starts)
  const kinds = new Map(cuts.map((i) => [i, 'cut']));
  const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 60;
  for (let i = 1; i < n; i++) if (far(rows[i].bg, rows[i - 1].bg) && ![1, 2, 3].some((k) => kinds.has(i - k))) kinds.set(i, 'colour');
  const empty = Math.max(0.002, 0.004 * sensitivity);
  for (let i = 1; i < n; i++) {
    if (!(rows[i - 1].ink <= empty && rows[i].ink > empty)) continue;
    let j = i - 1; while (j > 0 && rows[j - 1].ink <= empty) j--;
    if (i - j < 2 || j === 0) continue; // a lone frame, or the opening build
    if (![...kinds.keys()].some((k) => Math.abs(k - i) <= Math.round(fps * 0.3))) kinds.set(i, 'empty');
  }
  cuts.length = 0; cuts.push(...[...kinds.keys()].sort((a, b) => a - b));
  // heavy change over several frames: a wipe, whip or flood (not a hard cut)
  let start = -1;
  for (let i = 1; i <= n; i++) {
    const busy = i < n && d[i] > Math.max(2.5, med * 4) * sensitivity && !cuts.includes(i);
    if (busy && start < 0) start = i;
    if (!busy && start >= 0) { if (i - start >= Math.round(fps * 0.1)) moves.push([start, i - 1]); start = -1; }
  }
  return { cuts, kinds, moves, med };
}
// holds: stretches with almost nothing moving (the eye reads here)
function findHolds(rows, fps) {
  const out = []; let start = -1;
  for (let i = 1; i <= rows.length; i++) {
    const still = i < rows.length && rows[i].diff < 0.12;
    if (still && start < 0) start = i;
    if (!still && start >= 0) { if (i - start >= Math.round(fps * 0.2)) out.push([start, i - 1]); start = -1; }
  }
  return out;
}

// tempo from the sound: an onset envelope, its autocorrelation, weighted toward 120 BPM
async function tempoFromSound(file, from, to) {
  const SR = 11025, HOP = 128, WIN = 512;
  let pcm;
  try { pcm = await run('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', file, '-t', String(to - from), '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { capture: true }); } catch { return null; }
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  if (x.length < SR * 3) return null;
  const env = [];
  let last = 0;
  for (let p = 0; p + WIN <= x.length; p += HOP) {
    let e = 0; for (let k = p; k < p + WIN; k++) e += x[k] * x[k];
    const l = Math.log(1e-8 + e / WIN);
    env.push(Math.max(0, l - last)); last = l;
  }
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const o = env.map((v) => v - mean), rate = SR / HOP;
  let best = null;
  const score = (bpm) => {
    const lag = (60 / bpm) * rate, l0 = Math.floor(lag), fr = lag - l0;
    let s = 0; for (let i = 0; i + l0 + 1 < o.length; i++) s += o[i] * (o[i + l0] * (1 - fr) + o[i + l0 + 1] * fr);
    return s;
  };
  const all = [];
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const s = score(bpm) * Math.exp(-0.5 * Math.log2(bpm / 120) ** 2 / 0.5 ** 2);
    all.push(s);
    if (!best || s > best.s) best = { bpm, s };
  }
  if (!best || best.s <= 0) return null;
  const avg = all.reduce((a, b) => a + Math.max(0, b), 0) / all.length;
  // phase: where the beats fall
  const period = (60 / best.bpm) * rate;
  let phase = 0, top = -Infinity;
  for (let p = 0; p < period; p++) {
    let s = 0; for (let k = p; k < env.length; k += period) s += env[Math.round(k)] || 0;
    if (s > top) { top = s; phase = p; }
  }
  return { bpm: best.bpm, firstBeat: +(from + phase / rate).toFixed(3), confidence: +(best.s / (avg || 1)).toFixed(2), from: 'sound' };
}
// otherwise: the grid that the cuts fit best
function tempoFromCuts(times) {
  if (times.length < 3) return null;
  let best = null;
  for (let bpm = 80; bpm <= 160; bpm += 0.5) {
    const half = 30 / bpm;
    for (let k = 0; k < 40; k++) {
      const ph = (k / 40) * half;
      const err = times.reduce((s, t) => { const r = ((t - ph) % half + half) % half; return s + (Math.min(r, half - r) / (half / 2)) ** 2; }, 0) / times.length;
      if (!best || err < best.err - 1e-9) best = { bpm, err, ph };
    }
  }
  return { bpm: best.bpm, firstBeat: +best.ph.toFixed(3), confidence: +(1 - best.err).toFixed(2), from: 'cuts (a guess: check it)' };
}

// colours of a small frame: the most common, merged, with their share; the saturated one is the likely accent
function colours(f) {
  const bins = new Map();
  for (let p = 0; p < f.length; p += 3) {
    const key = ((f[p] >> 4) << 8) | ((f[p + 1] >> 4) << 4) | (f[p + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += f[p]; b.g += f[p + 1]; b.b += f[p + 2]; bins.set(key, b);
  }
  const total = f.length / 3, list = [...bins.values()].map((b) => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n], n: b.n })).sort((a, b) => b.n - a.n);
  const merged = [];
  for (const c of list) {
    const near = merged.find((m) => Math.abs(m.rgb[0] - c.rgb[0]) + Math.abs(m.rgb[1] - c.rgb[1]) + Math.abs(m.rgb[2] - c.rgb[2]) < 48);
    if (near) near.n += c.n; else merged.push({ ...c });
  }
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx < 40 ? 0 : (mx - mn) / mx; };
  return merged.filter((m) => m.n / total >= 0.004).slice(0, 5).map((m) => ({ hex: hex(m.rgb), share: +(m.n / total).toFixed(3), ...(sat(m.rgb) > 0.35 ? { saturated: true } : {}) }));
}
// the box of everything that isn't the background, inside a margin (corner labels stay out of it)
function contentBox(f, W, H, margin = 0.05) {
  const bg = [0, 1, 2].map((k) => { const v = []; for (let p = k; p < f.length; p += 3 * 7) v.push(f[p]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  const mx = Math.round(W * margin), my = Math.round(H * margin);
  for (let y = my; y < H - my; y++) for (let x = mx; x < W - mx; x++) {
    const p = (y * W + x) * 3;
    if (Math.abs(f[p] - bg[0]) + Math.abs(f[p + 1] - bg[1]) + Math.abs(f[p + 2] - bg[2]) > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const r = (v) => +v.toFixed(3);
  return { x: r(x0 / W), y: r(y0 / H), w: r((x1 - x0 + 1) / W), h: r((y1 - y0 + 1) / H) };
}

// the frame nearest t (seeking a quarter frame early, so ffmpeg lands on that frame and not the next)
export async function still(file, t, out, fps = 60, width) {
  const n = Math.max(0, Math.round(t * fps));
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, (n - 0.25) / fps)), '-i', file, '-frames:v', '1', ...(width ? ['-vf', `scale=${width}:-2`] : []), out]);
}

// ---------- the command ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const [input, outArg] = args;
  if (!input || !outArg || input.startsWith('--')) { console.error('usage: node scripts/study.mjs <video file | post URL> <out-dir> [--every 0.5] [--times a,b] [--from s --to s] [--strip t,t] [--track x,y,w,h@t0-t1] [--bpm n] [--against study.json --shift s]'); process.exit(1); }
  const out = path.resolve(outArg);
  await mkdir(out, { recursive: true });

  let file = input, credit = null;
  if (/^https?:\/\//.test(input)) {
    try { ({ file, credit } = await fetchPost(input, out)); console.log(`fetched the video of ${credit.handle ? '@' + credit.handle + "'s" : 'the'} post: ${file}`); }
    catch (err) { console.error(`${err.message}.\nAsk the user for the video file (download it from the post) and run this again with its path.`); process.exit(2); }
  } else if (!existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1); }
  if (!credit && existsSync(path.join(out, 'post.json'))) credit = JSON.parse(await readFile(path.join(out, 'post.json'), 'utf8'));

  const info = probe(file);
  const from = Math.max(0, Number(opt('from', 0))), to = Math.min(info.duration, Number(opt('to', info.duration)));
  const step = Number(opt('every', 0.5));
  const times = opt('times') ? opt('times').split(',').map(Number) : (() => { const l = []; for (let t = from; t < to - 1 / (info.fps || 30); t += step) l.push(+t.toFixed(3)); return l; })();
  const fr = await frames(file, info, { from, to, keep: new Set(times) });
  const fps = fr.fps, T = (i) => fr.rows[i].t;
  const { cuts, kinds, moves } = findCuts(fr.rows, fps, Number(opt('cut', 1)));
  const holds = findHolds(fr.rows, fps);
  const cutTimes = cuts.map(T);
  const tempo = opt('bpm') ? { bpm: Number(opt('bpm')), firstBeat: Number(opt('beat', from)), from: 'given' } : (info.audio && (await tempoFromSound(file, from, to))) || tempoFromCuts(cutTimes);
  const beat = tempo ? 60 / tempo.bpm : null;
  const onGrid = (t) => { if (!beat) return null; const b = (t - tempo.firstBeat) / beat, n = Math.round(b * 2) / 2; return { beat: n, off: Math.round((b - n) * beat * fps) }; };

  const bounds = [0, ...cuts, fr.rows.length];
  const shots = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1] - 1;
    if (b < a) continue;
    const t0 = T(a), t1 = T(b) + 1 / fps;
    shots.push({ n: shots.length + 1, from: +t0.toFixed(3), to: +t1.toFixed(3), length: +(t1 - t0).toFixed(3), frames: b - a + 1, beats: beat ? +((t1 - t0) / beat).toFixed(2) : null, startsOn: k ? onGrid(t0) : null, after: k ? kinds.get(a) : null,
      moves: moves.filter(([m0, m1]) => m0 >= a && m1 <= b).map(([m0, m1]) => [+T(m0).toFixed(3), +(T(m1) + 1 / fps).toFixed(3)]),
      holds: holds.filter(([h0, h1]) => h0 >= a && h1 <= b).map(([h0, h1]) => [+T(h0).toFixed(3), +(T(h1) + 1 / fps).toFixed(3)]) });
  }

  // stills: full size for measuring, and a labelled sheet
  const fdir = path.join(out, 'frames');
  await rm(fdir, { recursive: true, force: true });
  await mkdir(fdir, { recursive: true });
  const stills = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(fdir, `${String(i).padStart(3, '0')}-${t.toFixed(2)}s.png`);
    await still(file, t, f, info.fps);
    const small = fr.kept.get(t);
    const shot = shots.find((s) => t >= s.from - 1e-6 && t < s.to - 1e-6);
    stills.push({ t, file: path.relative(out, f), shot: shot?.n ?? null, frame: Math.round(t * fps), box: small ? contentBox(small, fr.AW, fr.AH) : null, colours: small ? colours(small) : [] });
  }
  const cutBefore = (i) => i > 0 && cutTimes.some((c) => c > times[i - 1] && c <= times[i]);
  const tall = info.height > info.width;
  await sheet([{ cells: stills.map((s, i) => ({ file: path.join(out, s.file), label: `${s.t.toFixed(2)} s · f${s.frame}${s.shot ? ' · shot ' + s.shot : ''}${cutBefore(i) ? ' · cut' : ''}`, cut: cutBefore(i) })) }], path.join(out, 'sheet.png'), { width: tall ? 200 : 320, cols: tall ? 8 : 5 });

  // strips: consecutive frames, for easing
  for (const t0 of opt('strip') ? opt('strip').split(',').map(Number) : []) {
    const count = Number(opt('count', 12)), sdir = path.join(out, `strip-${t0}`);
    await rm(sdir, { recursive: true, force: true }); await mkdir(sdir, { recursive: true });
    const cells = [];
    for (let k = 0; k < count; k++) {
      const t = t0 + k / info.fps, f = path.join(sdir, `${String(k).padStart(2, '0')}.png`);
      await still(file, t, f, info.fps);
      cells.push({ file: f, label: `${t.toFixed(3)} s · f${Math.round(t * info.fps)}${k ? ` · +${k}` : ''}` });
    }
    await sheet([{ cells }], path.join(out, `strip-${t0}.png`), { width: tall ? 200 : 320, cols: 6 });
    console.log(`wrote ${path.join(out, `strip-${t0}.png`)}`);
  }

  // tracks: the box of everything that isn't background inside a region, frame by frame
  for (const spec of opt('track') ? opt('track').split(';') : []) {
    const [reg, span] = spec.split('@'), [rx, ry, rw, rh] = reg.split(',').map(Number), [a, b] = (span || `${from}-${to}`).split('-').map(Number);
    const TW = 480, TH = Math.round((TW * info.height) / info.width / 2) * 2, size = TW * TH * 3, tf = Math.min(60, info.fps || 30);
    const x0 = Math.round(rx * TW), y0 = Math.round(ry * TH), x1 = Math.round((rx + rw) * TW), y1 = Math.round((ry + rh) * TH);
    const rowsT = [];
    let buf = Buffer.alloc(0), k = 0, bg = null;
    const one = (f) => {
      if (!bg) bg = [0, 1, 2].map((c) => { const v = []; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 3) v.push(f[(y * TW + x) * 3 + c]); v.sort((m, n) => m - n); return v[v.length >> 1]; }); // the region's own background, from its first frame
      let bx0 = TW, by0 = TH, bx1 = -1, by1 = -1;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = (y * TW + x) * 3;
        if (Math.abs(f[p] - bg[0]) + Math.abs(f[p + 1] - bg[1]) + Math.abs(f[p + 2] - bg[2]) > 60) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      }
      const r = (v) => +v.toFixed(4), t = a + k / tf;
      rowsT.push(bx1 < 0 ? { t: r(t), f: Math.round(t * tf), box: null } : { t: r(t), f: Math.round(t * tf), box: [r(bx0 / TW), r(by0 / TH), r((bx1 - bx0 + 1) / TW), r((by1 - by0 + 1) / TH)] });
      k++;
    };
    await run('ffmpeg', ['-v', 'error', '-ss', String(a), '-i', file, '-t', String(b - a), '-vf', `fps=${tf},scale=${TW}:${TH}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
      capture: true, onData: (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= size) { one(buf.subarray(0, size)); buf = buf.subarray(size); } },
    });
    const tfile = path.join(out, `track-${a}.json`);
    await writeFile(tfile, JSON.stringify({ region: [rx, ry, rw, rh], from: a, to: b, fps: tf, frames: rowsT }, null, 1) + '\n');
    console.log(`track of ${reg} from ${a} to ${b} s (x, y, w, h as fractions of the frame):`);
    let last = '';
    for (const r of rowsT) { const line = r.box ? r.box.map((v) => v.toFixed(3)).join(', ') : 'empty'; if (line !== last) console.log(`  ${r.t.toFixed(3)} s  f${r.f}  ${line}`); last = line; }
    console.log(`wrote ${tfile}`);
  }

  // activity: how much moves in each quarter second, as a bar per quarter (the film's pulse)
  const BARS = ' ▁▂▃▄▅▆▇█', q = Math.round(fps / 4), act = [];
  for (let i = 0; i < fr.rows.length; i += q) act.push(fr.rows.slice(i, i + q).reduce((a, r) => a + r.diff, 0) / q);
  const top = Math.max(...act, 1e-6), pulse = act.map((a) => BARS[Math.min(8, Math.round(Math.sqrt(a / top) * 8))]).join('');

  const study = { source: credit ? credit.url : path.resolve(file), credit, size: [info.width, info.height], shape: shapeOf(info.width, info.height), fps: info.fps, duration: +info.duration.toFixed(3), from, to, tempo, cuts: cutTimes.map((t) => +t.toFixed(3)), shots, stills, pulse: { every: 0.25, bars: pulse } };
  await writeFile(path.join(out, 'study.json'), JSON.stringify(study, null, 1) + '\n');

  const md = [];
  md.push(`# Shots: ${credit?.handle ? '@' + credit.handle + "'s video" : path.basename(file)}`, '');
  if (credit) md.push(`Video by @${credit.handle}: ${credit.url} (${credit.posted || 'date unknown'})`, '');
  md.push(`${info.width} × ${info.height} (${study.shape}), ${info.fps} fps, ${info.duration.toFixed(2)} s${from || to < info.duration ? `; studied ${from}–${to.toFixed(2)} s` : ''}.`);
  md.push(tempo ? `Tempo: ${tempo.bpm} BPM (a beat every ${beat.toFixed(3)} s, first beat at ${tempo.firstBeat} s), from the ${tempo.from}${tempo.confidence ? `, confidence ${tempo.confidence}` : ''}. Check it against the cuts below.` : 'Tempo: not found. Time the shots in seconds.', '');
  md.push('Pulse, a bar per quarter second (tall = more moving), a line per 4 s:', '', '```');
  for (let i = 0; i < pulse.length; i += 16) md.push(`${(from + i * 0.25).toFixed(1).padStart(5)} s  ${pulse.slice(i, i + 16)}`);
  md.push('```', '');
  md.push('Shots start after a hard cut, a change of background colour (a flood) or an empty frame; morphs and wipes inside a shot are listed as moves. Your eyes decide the rest.', '');
  md.push('| Shot | From | To | Length | Beats | Starts on (after a) | Moves (wipes, whips) | Holds | What happens (fill in by eye) |', '|---|---|---|---|---|---|---|---|---|');
  for (const s of shots) md.push(`| ${s.n} | ${s.from.toFixed(2)} | ${s.to.toFixed(2)} | ${s.length.toFixed(2)} s (${s.frames} f) | ${s.beats ?? ''} | ${s.startsOn ? `beat ${s.startsOn.beat}${s.startsOn.off ? ` ${s.startsOn.off > 0 ? '+' : ''}${s.startsOn.off} f` : ''} (${s.after})` : ''} | ${s.length < 0.15 ? 'a flash: ' : ''}${s.moves.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(', ')} | ${s.holds.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(', ')} | |`);
  md.push('', 'Stills (full size in frames/): content box as fractions of the frame (x, y, w, h, inside a 5% margin) and colours by share; * = saturated, likely the accent.', '', '| Time | Shot | Box | Colours |', '|---|---|---|---|');
  for (const s of stills) md.push(`| ${s.t.toFixed(2)} | ${s.shot ?? ''} | ${s.box ? [s.box.x, s.box.y, s.box.w, s.box.h].join(', ') : 'empty'} | ${s.colours.map((c) => `${c.hex} ${Math.round(c.share * 100)}%${c.saturated ? '*' : ''}`).join(' ')} |`);
  await writeFile(path.join(out, 'SHOTS.md'), md.join('\n') + '\n');

  console.log(`${info.width}×${info.height} ${study.shape}, ${info.fps} fps, ${info.duration.toFixed(2)} s; ${shots.length} shots, ${cuts.length} cuts${tempo ? `; ${tempo.bpm} BPM (${tempo.from})` : ''}`);
  for (const s of shots) console.log(`  shot ${s.n}: ${s.from.toFixed(2)}–${s.to.toFixed(2)} s (${s.length.toFixed(2)} s${s.beats ? `, ${s.beats} beats` : ''})`);
  console.log(`wrote ${path.join(out, 'SHOTS.md')}, study.json, sheet.png and ${stills.length} stills in frames/`);

  // this video's cuts against another study's
  if (opt('against')) {
    const other = JSON.parse(await readFile(opt('against'), 'utf8')), f = other.fps || fps;
    // this video's time → the other's: one --shift, or a --map of film:reference pairs (as compare.mjs takes)
    const pairs = opt('map') ? opt('map').split(',').map((p) => p.split(':').map(Number)).sort((a, b) => a[0] - b[0]) : [[0, Number(opt('shift', 0))]];
    const toOther = (t) => { let m = pairs[0]; for (const p of pairs) if (t >= p[0] - 1e-9) m = p; return m[1] + (t - m[0]); };
    const shift = pairs.length === 1 && pairs[0][0] === 0 ? pairs[0][1] : null;
    console.log(`\ncuts against ${opt('against')} (${shift !== null ? `this + ${shift} s = that` : `mapped ${opt('map')}`}):`);
    const used = new Set();
    for (const c of cutTimes) {
      const t = toOther(c), near = other.cuts.reduce((b, o) => (Math.abs(o - t) < Math.abs(b - t) ? o : b), Infinity);
      const d = Math.round((t - near) * f);
      if (Math.abs(t - near) <= 0.5) { used.add(near); console.log(`  ${c.toFixed(3)} s ↔ ${near.toFixed(3)} s: ${d === 0 ? 'on the frame' : `${Math.abs(d)} frame${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "late" : "early"}`}`); }
      else console.log(`  ${c.toFixed(3)} s: no cut there in the other (extra)`);
    }
    const back = (o) => { let best = null; for (const [a, b] of pairs) { const t = a + (o - b); if (toOther(t) === o || Math.abs(toOther(t) - o) < 1e-6) best = t; } return best; };
    for (const o of other.cuts) { const here = back(o); if (!used.has(o) && here !== null && here >= from && here <= to) console.log(`  missing: the other cuts at ${o.toFixed(3)} s (${here.toFixed(3)} s here)`); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
