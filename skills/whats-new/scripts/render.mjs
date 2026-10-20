// Render a film (a folder with index.html exposing window.template) in headless
// Chrome: stills, contact sheets, checks and MP4s.
//
//   node scripts/render.mjs <film-dir> [options]
//     --size 16:9|9:16|1:1   one size (default 16:9); --all for every size the film has
//     --values file.json     extra values over defaults and <film-dir>/values.json
//     --every 0.5 --sheet    a still every N seconds, tiled into <name>-sheet.png
//     --times 0,1.5,3        stills at these times ('key': the film's own template.keyTimes)
//     --phone                one frame a second at 360 px wide, tiled: the phone-size check
//     --strip 4.2            12 consecutive frames starting at 4.2 s: catches pops and overlaps
//     --check                determinism: render frames twice, in different orders, compare pixels
//     --video                every frame at the film's fps (template.fpsBySize[size] if set), encoded to <name>.mp4
//     --blur 4               motion blur: average 4 sub-frames across half a frame (a 180° shutter;
//                            a film's template.shutters can widen it in places)
//     --sound                add effects from the sound kit on the film's cues (needs --video)
//     --music                add the film's own score (window.template.music), synthesised (needs --video)
//     --audio song.wav       a song instead of --music (needs --video), fitted by song.mjs: it starts on
//                            a bar line, and on the last bar line at least 3.5 s before the end lands one
//                            hit and closes down and fades (with its stems, in song-stems/ beside it or
//                            --stems dir: the drums play that hit and stop, the rest closes and fades);
//                            under --sound effects only its 250–1500 Hz dips. --from 92 starts at the bar
//                            line nearest 92 s in the song (another section); --stems none ignores stems;
//                            --ending 51.6 splices into the song's own ending there instead; a song
//                            within 10% of the film's BPM is time-stretched to it (--keep-tempo: not);
//                            once it lands, the film's result sounds (pop, ping, sparkle, chime) are left out;
//                            --bpm 121.05 and --downbeat 0.02 override what it measures; --land 34 lands the
//                            hit on the bar line nearest 34 s in the film (the film's own last hit)
//     --poster 12.8          a PNG of one frame, for thumbnails
//                            (a film can set a delivery spec per size, template.encode, e.g. for an App
//                            Store preview: { '886:1920': { bitrate: '11M', minrate: '11M', maxrate: '11M',
//                            bufsize: '11M', x264: 'nal-hrd=cbr', profile: 'high', level: '4.0',
//                            audioBitrate: '256k' } }, a constant 11 Mbps; otherwise --video
//                            encodes H.264 at CRF 17 with 192 kbps AAC)
//     --stress               the quick test: at every key time, with the default words, every text
//                            field at its longest (wide letters) and at its shortest. Fails when the
//                            words are cut by the frame's edge, overlap other text or fall under the
//                            size floor (28 px at 1440 px on the short side) where the default words
//                            didn't, and always when text is set with textBaseline 'middle' (it sits
//                            high in its container; kit.centreText centres on the capitals); writes
//                            sheets and report.json to <out>/stress/ for a reviewer
//     --out dir              (default <film-dir>/../out)
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { requireChrome, chromeArgs } from './chrome.mjs';
import { effects } from './sfx.mjs';
import { compose, wav as toWav, LUFS as MUSIC_LUFS } from './music.mjs';
import { fitSong } from './song.mjs';

// the sounds that say "it arrived": after a fitted song lands they're left out (see --audio)
const RESULTS = new Set(['pop', 'ping', 'sparkle', 'chime']);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav' };

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes('--' + name);
if (!args[0] || args[0].startsWith('--')) { console.error('usage: node scripts/render.mjs <film-dir> [options]'); process.exit(1); }
const dir = path.resolve(args[0]);
const outDir = path.resolve(opt('out', path.join(dir, '..', 'out')));
let saved = {};
try { saved = JSON.parse(await readFile(path.join(dir, 'values.json'), 'utf8')); }
catch (err) { if (err.code !== 'ENOENT') throw err; }
const extra = { ...saved, ...(opt('values') ? JSON.parse(await readFile(opt('values'), 'utf8')) : {}) };

// Static server for the film folder, with the CORS header a sandboxed player needs.
const server = createServer(async (req, res) => {
  const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: requireChrome(), headless: true, args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', ...chromeArgs()] });
let failed = false;
const stressProblems = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('film error:', e.message); failed = true; });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) console.error('film console:', m.text()); }); // missing files are reported below, by URL
  page.on('requestfailed', (r) => console.error('could not load:', r.url()));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) console.error(`missing (${r.status()}):`, r.url().replace(origin, '')); });
  if (flag('stress')) await page.evaluateOnNewDocument(recordText);
  await page.goto(`${origin}/index.html?render=1`, { waitUntil: 'load' });
  const meta = await page.evaluate(() => {
    const T = window.template;
    return T ? { fps: T.fps, fpsBySize: T.fpsBySize || null, duration: T.duration, sizes: Object.keys(T.sizes), hasCues: typeof T.cues === 'function', music: T.music || null, cuts: T.cuts || [], shutters: T.shutters || [], keyTimes: T.keyTimes || [], encode: T.encode || null } : null;
  });
  if (!meta) throw new Error('index.html did not set window.template');
  const sizes = flag('all') ? meta.sizes : [opt('size', '16:9')];
  await mkdir(outDir, { recursive: true });

  for (const size of sizes) {
    const values = { ...(await page.evaluate(() => window.template.defaults())), ...extra, size };
    const name = size.replace(':', 'x');
    // a film may set a frame rate per size (template.fpsBySize), e.g. 60 for social and 30 for a store cut
    const fps = (meta.fpsBySize && meta.fpsBySize[size]) || meta.fps;
    await page.evaluate((v) => window.template.prepare(v), values);
    const frame = (t) => page.evaluate((t, v) => window.template.seek(t, v).toDataURL('image/png'), t, values);
    const png = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const stills = async (label, times) => {
      const d = path.join(outDir, `${name}-${label}`);
      await rm(d, { recursive: true, force: true });
      await mkdir(d, { recursive: true });
      for (const [i, t] of times.entries()) await writeFile(path.join(d, `${String(i).padStart(3, '0')}.png`), png(await frame(t)));
      return d;
    };
    const tile = async (d, width, cols, file) => {
      const count = (await import('node:fs')).readdirSync(d).length;
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '1', '-i', path.join(d, '%03d.png'), '-vf', `scale=${width}:-1,tile=${cols}x${Math.ceil(count / cols)}:padding=4:color=white`, '-frames:v', '1', file]);
      console.log(`wrote ${file}`);
    };
    const range = (step) => { const out = []; for (let t = 0; t < meta.duration - 1e-9; t += step) out.push(+t.toFixed(4)); return out; };

    let times = [];
    if (opt('times') === 'key') times = meta.keyTimes.slice();
    else if (opt('times')) times = opt('times').split(',').map(Number);
    else if (opt('every')) times = range(Number(opt('every')));

    if (flag('check')) {
      const list = times.length ? times : range(0.37);
      const hash = (b) => createHash('sha256').update(b).digest('hex');
      const first = new Map();
      for (const t of list) first.set(t, hash(png(await frame(t))));
      let bad = 0;
      for (const t of [...list].reverse()) if (hash(png(await frame(t))) !== first.get(t)) { bad++; console.log(`${size}: frame at ${t}s differs`); }
      console.log(bad ? `${size} determinism: FAIL (${bad} of ${list.length} frames differ)` : `${size} determinism: pass (${list.length} frames, two orders)`);
      if (bad) failed = true;
    } else if (times.length) {
      const d = await stills('stills', times);
      console.log(`wrote ${times.length} stills to ${d}`);
      if (flag('sheet')) await tile(d, size === '9:16' ? 220 : 384, size === '9:16' ? 8 : 5, path.join(outDir, `${name}-sheet.png`));
    }
    if (flag('phone')) await tile(await stills('phone', range(1)), 360, 5, path.join(outDir, `${name}-phone.png`));
    if (opt('strip')) {
      const t0 = Number(opt('strip'));
      await tile(await stills('strip', Array.from({ length: 12 }, (_, i) => t0 + i / fps)), 320, 6, path.join(outDir, `${name}-strip.png`));
    }
    if (opt('poster')) {
      const file = path.join(outDir, `${name}-poster.png`);
      await writeFile(file, png(await frame(Number(opt('poster')))));
      console.log(`wrote ${file}`);
    }

    if (flag('video')) {
      const silent = path.join(outDir, `${name}-silent.mp4`), file = path.join(outDir, `${name}.mp4`);
      const sub = Math.max(1, Number(opt('blur', 1)));
      // the film's delivery spec for this size, if it has one: a set bitrate, profile and level
      const spec = (meta.encode && meta.encode[size]) || null;
      const rate = spec ? ['-profile:v', spec.profile || 'high', '-level:v', String(spec.level || '4.0'), '-b:v', spec.bitrate, '-maxrate', spec.maxrate || spec.bitrate, '-bufsize', spec.bufsize || spec.maxrate || spec.bitrate, ...(spec.minrate ? ['-minrate', spec.minrate] : []), ...(spec.x264 ? ['-x264-params', spec.x264] : [])] : ['-crf', '17'];
      const vf = sub > 1 ? ['-vf', `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/${fps}/TB`] : [];
      const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps * sub), '-i', '-', ...vf, '-r', String(fps), '-c:v', 'libx264', ...rate, '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
      const total = Math.round(meta.duration * fps);
      for (let i = 0; i < total; i++) {
        for (let k = 0; k < sub; k++) {
          const t0 = i / fps;
          // shutter: half a frame by default (180°); a film can ask for more in places: shutters [[from, to, fraction]]
          const sh = (meta.shutters.find(([a, b2]) => t0 >= a && t0 < b2) || [0, 0, 0.5])[2];
          let t = (i + (sub > 1 ? (k / sub) * sh : 0)) / fps;
          // a sub-frame past a hard cut would blend two shots: hold it just before the cut
          const cut = meta.cuts.find((c) => c > t0 && c <= t);
          if (cut !== undefined) t = cut - 1e-4;
          if (!ff.stdin.write(png(await frame(t)))) await new Promise((r) => ff.stdin.once('drain', r));
        }
      }
      ff.stdin.end();
      await new Promise((r) => ff.on('close', r));
      const tracks = []; // [file, volume]
      const song = opt('audio');
      if (song && flag('music')) console.log('--audio replaces --music: the film\'s own score is left out');
      if (flag('music') && meta.music && !song) {
        const file = path.join(outDir, `${name}-music.wav`);
        // the film's name seeds its song (key, progressions, motif, patterns, palette) unless it sets music.seed
        const film = path.basename(dir) === 'reference' ? path.basename(path.dirname(dir)) : path.basename(dir);
        await writeFile(file, toWav(compose({ film, ...meta.music, duration: meta.duration })));
        // the score comes mastered (−14 LUFS, peaks ~11 dB over that); at −17 LUFS it sits against the effects
        // where the old synth did, with its peaks under the −6 dBFS limiter below, so it isn't limited twice
        tracks.push([file, +(10 ** ((-17 - MUSIC_LUFS) / 20)).toFixed(3)]);
      }
      let sfx = null, cueList = null;
      const sfxFile = path.join(outDir, `${name}-sfx.wav`);
      if (flag('sound') && meta.hasCues) {
        cueList = await page.evaluate((v) => window.template.cues(v), values);
        sfx = effects(cueList, meta.duration);
        await writeFile(sfxFile, sfx);
        tracks.push([sfxFile, tracks.length ? 0.55 : 1]);
      }
      if (song) {
        const num = (k) => (opt(k) === undefined ? undefined : Number(opt(k)));
        const stems = opt('stems') === undefined ? undefined : opt('stems') === 'none' ? false : path.resolve(opt('stems'));
        const fit = (fx) => fitSong(path.resolve(song), { duration: meta.duration, sfx: fx, bpm: num('bpm'), downbeat: num('downbeat'), from: num('from') ?? 0, stems, ending: num('ending'), land: num('land'), tempo: flag('keep-tempo') ? undefined : meta.music?.bpm });
        let { wav, report: r } = await fit(sfx);
        // Once the song has landed and is closing, results stay quiet: a pop over the fading song sounds
        // like more is coming, not like the end (the founder, 2026-10-19). Clicks, typing and moves keep theirs.
        const late = cueList && r.ending !== 'song' ? cueList.filter((c) => RESULTS.has(c.type) && c.t > r.at + 0.05) : [];
        if (late.length) {
          sfx = effects(cueList.filter((c) => !late.includes(c)), meta.duration);
          await writeFile(sfxFile, sfx);
          ({ wav, report: r } = await fit(sfx));
          console.log(`quiet after the song lands (${r.at} s): ${late.map((c) => `${c.type} ${c.t.toFixed(2)}`).join(', ')}`);
        }
        const file = path.join(outDir, `${name}-song.wav`);
        await writeFile(file, wav);
        tracks.unshift([file, 1]);
        if (meta.music && !r.stretchedTo && Math.abs(r.bpm / meta.music.bpm - 1) > 0.02) console.log(`note: the song is ${r.bpm} BPM; the film's cuts are on a ${meta.music.bpm} BPM grid (more than 10% apart, so not stretched)`);
        console.log(`song: ${r.bpm} BPM${r.stretchedTo ? ` stretched to ${r.stretchedTo}` : ''}, from ${r.start} s; ${r.ending === 'song' ? `its own ending from ${r.from} s comes in at ${r.at} s, ringing ${r.ring} s` : `lands at ${r.at} s and closes, ${r.ending}`}`);
      }
      if (tracks.length) {
        const inputs = tracks.flatMap(([f]) => ['-i', f]);
        const chains = tracks.map(([, v], i) => `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${v}[a${i}]`).join(';');
        const mixIn = tracks.map((_, i) => `[a${i}]`).join('');
        // Catch transient peaks at −6 dBFS before normalization, so short
        // impacts don't force the sustained mix below the loudness target.
        // 10 ms lookahead and 200 ms release: slow enough not to bend a kick's waveform.
        const mix = (norm) => `${chains};${mixIn}amix=inputs=${tracks.length}:duration=longest:normalize=0,atrim=0:${meta.duration},alimiter=limit=0.5:attack=10:release=200:level=false,${norm},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]`; // the AAC encoder's own format: older ffmpeg (5.1) won't convert it for you
        // loudness in two passes: measure the mix, then normalise it to −14 LUFS from those numbers
        // (one pass guesses as it goes, and lands a few LU quiet on a clip of a few seconds)
        // Leave 1 dB for 48 kHz resampling and AAC intersample overshoot;
        // decoded exports should retain about −1.5 dBTP of peak headroom.
        const target = 'I=-14:TP=-2.5:LRA=11';
        const report = await capture('ffmpeg', ['-hide_banner', '-nostats', '-i', silent, ...inputs, '-filter_complex', mix(`loudnorm=${target}:print_format=json`), '-map', '[a]', '-f', 'null', '-']);
        const m = JSON.parse(report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1));
        const graph = mix(`loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`);
        await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', silent, ...inputs, '-filter_complex', graph, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', (spec && spec.audioBitrate) || '192k', '-movflags', '+faststart', file]);
        await rm(silent);
      } else await run('mv', [silent, file]);
      console.log(`wrote ${file} (${total} frames${tracks.length ? ', with sound' : ''})`);
    }

    if (flag('stress')) {
      const fields = await page.evaluate(() => (window.template.fields || []).filter((f) => f.type === 'text').map((f) => ({ id: f.id, maxLength: f.maxLength })));
      const extraCases = await page.evaluate(() => window.template.stress || {});
      const base = { ...(await page.evaluate(() => window.template.defaults())), ...extra, size };
      const cases = { defaults: base, long: { ...base }, short: { ...base }, ...Object.fromEntries(Object.entries(extraCases).map(([k, v]) => [k, { ...base, ...v }])) };
      for (const f of fields) {
        const was = String(base[f.id] ?? '');
        cases.long[f.id] = longText(was, f.maxLength || Math.round(was.length * 1.5));
        cases.short[f.id] = shortText(was);
      }
      const times = meta.keyTimes.length ? meta.keyTimes : range(1);
      const sdir = path.join(outDir, 'stress');
      await mkdir(sdir, { recursive: true });
      let measured = 0;
      const known = new Set(); // kind|time of every problem with the default words: the film as designed
      for (const [label, v] of Object.entries(cases)) {
        await page.evaluate((v) => window.template.prepare(v), v);
        const d = path.join(sdir, `${name}-${label}`);
        await rm(d, { recursive: true, force: true });
        await mkdir(d, { recursive: true });
        const words = fields.map((f) => String(v[f.id] ?? '')).filter(Boolean);
        const seen = new Set();
        for (const [i, t] of times.entries()) {
          const shot = await page.evaluate((t, v) => {
            const rec = window.__texts; rec.log.length = 0; rec.on = true;
            const c = window.template.seek(t, v); rec.on = false;
            return { w: c.width, h: c.height, texts: rec.log.filter((r) => r.canvas === c && r.alpha >= 0.5).map(({ text, box, size, middle }) => ({ text, box, size, middle })), png: c.toDataURL('image/png') };
          }, t, v);
          await writeFile(path.join(d, `${String(i).padStart(3, '0')}.png`), png(shot.png));
          measured += shot.texts.length;
          for (const p of textProblems(shot, words)) {
            if (label === 'defaults') { if (p.ours) known.add(`${p.kind}|${t}`); }
            const fails = p.kind === 'off-centre' || (label !== 'defaults' && p.ours && !known.has(`${p.kind}|${t}`));
            const key = `${p.kind}|${p.text}|${fails}`;
            if (seen.has(key)) continue;
            seen.add(key);
            stressProblems.push({ size, case: label, t, fails, ...p });
            if (fails) console.log(`${size} ${label} @${t}s: ${p.kind}: ${p.detail}`);
          }
        }
        await tile(d, size === '9:16' ? 220 : 384, size === '9:16' ? 8 : 5, path.join(sdir, `${name}-${label}-sheet.png`));
      }
      if (!measured) console.log(`${size} stress: no text measured (the film draws its words elsewhere); judge the sheets by eye`);
      await page.evaluate((v) => window.template.prepare(v), values);
    }
  }
  if (flag('stress')) {
    await writeFile(path.join(outDir, 'stress', 'report.json'), JSON.stringify(stressProblems, null, 2));
    const fails = stressProblems.filter((p) => p.fails).length, notes = stressProblems.length - fails;
    const where = path.join(outDir, 'stress');
    const noted = notes ? `; ${notes} notes for the reviewer (text the film itself crops, overlaps or sets small) in ${path.join(where, 'report.json')}` : '';
    console.log(fails ? `stress: FAIL (${fails} problems the words cause${noted})` : `stress: pass (${sizes.join(', ')}; defaults, long and short words${noted})`);
    console.log(`stress sheets for the reviewer: ${where}`);
    if (fails) failed = true;
  }
} catch (e) {
  console.error(e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
  if (failed) process.exitCode = 1;
}

// The quick test. In the page: every word the film draws (with fillText or strokeText, at 50%
// opacity or more), as a box in frame pixels and an on-screen size, followed through any helper
// canvas copied into the frame. Read-only: it measures, and draws nothing.
function recordText() {
  const P = CanvasRenderingContext2D.prototype, rec = { on: false, log: [] };
  window.__texts = rec;
  const place = (T, pts) => { pts = pts.map(([px, py]) => [T.a * px + T.c * py + T.e, T.b * px + T.d * py + T.f]); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const corners = ([l, t, r, b]) => [[l, t], [r, t], [l, b], [r, b]];
  for (const name of ['fillText', 'strokeText']) {
    const draw = P[name];
    P[name] = function (text, x, y, maxWidth) {
      if (rec.on && String(text).trim()) {
        const m = this.measureText(text), k = maxWidth !== undefined && m.width > maxWidth ? maxWidth / m.width : 1, T = this.getTransform();
        const box = [x - m.actualBoundingBoxLeft * k, y - m.actualBoundingBoxAscent, x + m.actualBoundingBoxRight * k, y + m.actualBoundingBoxDescent];
        const size = parseFloat((this.font.match(/([\d.]+)px/) || [])[1] || 0) * Math.sqrt(Math.abs(T.a * T.d - T.b * T.c));
        rec.log.push({ canvas: this.canvas, text: String(text), box: place(T, corners(box)), size, alpha: this.globalAlpha, middle: this.textBaseline === 'middle' });
      }
      return draw.apply(this, arguments);
    };
  }
  const copy = P.drawImage;
  P.drawImage = function (src, ...a) {
    if (rec.on && src instanceof HTMLCanvasElement && src !== this.canvas) {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = a.length === 8 ? a : a.length === 4 ? [0, 0, src.width, src.height, ...a] : [0, 0, src.width, src.height, a[0], a[1], src.width, src.height];
      const T = this.getTransform(), kx = dw / sw, ky = dh / sh;
      for (const e of rec.log.filter((e) => e.canvas === src)) {
        const [l, t, r, b] = e.box, inner = [dx + (l - sx) * kx, dy + (t - sy) * ky, dx + (r - sx) * kx, dy + (b - sy) * ky];
        rec.log.push({ canvas: this.canvas, text: e.text, box: place(T, corners(inner)), size: e.size * Math.sqrt(Math.abs(kx * ky * (T.a * T.d - T.b * T.c))), alpha: e.alpha * this.globalAlpha });
      }
    }
    return copy.apply(this, [src, ...a]);
  };
}

// In Node: what's wrong with one frame's words. Cut by the frame's edge (a word wholly outside
// is out of shot, not cut); overlapping another word by a fifth of the smaller one (the same word
// drawn twice in place is one word); the film's own words (its text fields) under 28 px at 1440 px
// on the short side, the phone limit. Small text in a product's UI is the product's, so not judged.
// A problem is the words' fault when it involves a field's words and the default words had no
// problem of that kind at that moment; the rest (crops and overlays by design) are notes.
function textProblems({ w, h, texts }, words) {
  const out = [], floor = 28 * Math.min(w, h) / 1440, round = (b) => b.map(Math.round).join(',');
  const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const meet = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  const ours = (s) => s.trim().length > 1 && words.some((v) => v.includes(s.trim()));
  texts = texts.filter((x) => area([Math.max(x.box[0], 0), Math.max(x.box[1], 0), Math.min(x.box[2], w), Math.min(x.box[3], h)]) > 0); // in shot
  for (const x of texts) {
    if (x.box[0] < -1 || x.box[1] < -1 || x.box[2] > w + 1 || x.box[3] > h + 1) out.push({ kind: 'cut by the edge', text: x.text, ours: ours(x.text), detail: `"${x.text}" at [${round(x.box)}] in ${w}×${h}` });
    if (x.size && x.size < floor - 0.01 && ours(x.text)) out.push({ kind: 'too small', text: x.text, ours: true, detail: `"${x.text}" at ${x.size.toFixed(1)} px (floor ${floor.toFixed(1)})` });
    // textBaseline 'middle' centres the em box, not the letters: words sit high in their pill
    if (x.middle) out.push({ kind: 'off-centre', text: x.text, ours: ours(x.text), detail: `"${x.text}" drawn with textBaseline 'middle', which sits it high; centre it with kit.centreText` });
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j], both = meet(a.box, b.box), small = Math.min(area(a.box), area(b.box));
    if (!small || both / small <= 0.2) continue;
    if (a.text === b.text && both / (area(a.box) + area(b.box) - both) > 0.8) continue;
    out.push({ kind: 'overlap', text: `${a.text}|${b.text}`, ours: ours(a.text) || ours(b.text), detail: `"${a.text}" and "${b.text}" (${Math.round(both / small * 100)}% of the smaller)` });
  }
  return out;
}

// Awkward words: a field at its longest, in wide letters (sentence case, keeping the original's
// end punctuation or domain), and at its shortest.
function longText(was, n) {
  const domain = (was.match(/\.[a-z]{2,}$/i) || [''])[0], end = (was.match(/[.!?]$/) || [''])[0];
  const cased = (s) => (/^[A-Z]/.test(was) ? s[0].toUpperCase() + s.slice(1) : s);
  if (!/\s/.test(was.trim())) return cased('wommawombat'.repeat(10).slice(0, Math.max(1, n - domain.length))) + domain;
  // whole words only, so the sheets never look clipped; short fillers bring it to the limit
  const words = ['maximum', 'workflow', 'momentum', 'meaning', 'homework', 'wombat', 'memo', 'warm'], fill = ['memo', 'warm', 'mom', 'wow', 'me', 'm'];
  const room = n - end.length, add = (s, w) => (s ? `${s} ${w}` : w);
  let s = '';
  for (let i = 0; add(s, words[i % words.length]).length <= room; i++) s = add(s, words[i % words.length]);
  for (const w of fill) if (add(s, w).length <= room) s = add(s, w);
  return cased(s || 'm'.repeat(Math.max(1, room))) + end;
}
function shortText(was) {
  const domain = (was.match(/\.[a-z]{2,}$/i) || [''])[0], end = (was.match(/[.!?]$/) || [''])[0];
  return /\s/.test(was.trim()) ? 'Go' + end : (domain ? 'q' + domain : 'Ox');
}

function capture(cmd, argv) { // run, and return what it printed to stderr (where ffmpeg reports)
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code ? reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)) : resolve(err)));
  });
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => spawn(cmd, argv, { stdio: 'inherit' }).on('close', (code) => code ? reject(new Error(`${cmd} exited ${code}`)) : resolve()));
}
