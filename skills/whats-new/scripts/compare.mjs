// Frame-locked comparison: render two films at the same moments and stack them,
// reference on top, yours below, so differences in timing, size and placement show.
//
//   node scripts/compare.mjs <reference-dir> <your-film-dir> <out.png> [--times 0.33,0.73,...] [--size 1:1]
//
// Without --times, the moments are the reference film's template.keyTimes.
//
// The reference can also be a video (an .mp4, .mov, .webm …): its frame at each moment sits
// above your film's, both labelled with their times and frame numbers.
//
//   node scripts/compare.mjs reference.mp4 <your-film-dir> <out.png> [--times a,b,c] [--size 16:9]
//     [--map 0:0,10.367:18.867]   where your film's shots come from in the reference: from your
//                                 time 0 it is the reference's 0; from your 10.367 s, its 18.867 s
//     [--shift 6]                 the same for one offset: the reference's time = yours + 6
//     [--ref-times a,b,c]         or the reference's moment for each of yours, one by one
//
// Without --times, the moments are your film's template.keyTimes.
import { spawn } from 'node:child_process';
import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const [refDir, filmDir, out] = args;
if (!refDir || !filmDir || !out) { console.error('usage: node scripts/compare.mjs <reference-dir | reference-video> <your-film-dir> <out.png> [--times a,b,c] [--size 1:1] [--map 0:0,8:14 | --shift s | --ref-times a,b,c]'); process.exit(1); }
const run = (cmd, argv) => new Promise((res, rej) => spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'inherit'] }).on('close', (c) => (c ? rej(new Error(`${cmd} exited ${c}`)) : res())));
const isVideo = /\.(mp4|m4v|mov|webm|mkv|gif)$/i.test(refDir) && (await stat(refDir).catch(() => null))?.isFile();

if (isVideo) await againstVideo();
else await againstFilm();

async function againstFilm() {
  const size = opt('size', '1:1');
  const tmp = path.join(os.tmpdir(), `compare-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const times = opt('times', 'key'); // default: the reference film's own key moments
  const tag = size.replace(':', 'x');
  await run('node', [path.join(here, 'render.mjs'), refDir, '--size', size, '--times', times, '--out', path.join(tmp, 'a')]);
  const n = (await readdir(path.join(tmp, 'a', `${tag}-stills`))).length;
  if (!n) { console.error('no frames: pass --times, or give the reference film template.keyTimes'); process.exit(1); }
  // your film at the reference's moments
  const refTimes = times === 'key' ? await keyTimesOf(refDir) : times;
  await run('node', [path.join(here, 'render.mjs'), filmDir, '--size', size, '--times', refTimes, '--out', path.join(tmp, 'b')]);
  const cols = Math.min(10, n), rowsN = Math.ceil(n / cols);
  // one strip per film per row of `cols` frames, reference strip above yours
  const strips = [];
  for (let r = 0; r < rowsN; r++) {
    for (const name of ['a', 'b']) {
      const file = path.join(tmp, `${name}-${r}.png`);
      const start = r * cols, count = Math.min(cols, n - start);
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-start_number', String(start), '-framerate', '1', '-i', path.join(tmp, name, `${tag}-stills`, '%03d.png'), '-frames:v', String(count), '-vf', `scale=360:-1,tile=${cols}x1:padding=4:color=white`, '-frames:v', '1', file]);
      strips.push(file);
    }
  }
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...strips.flatMap((f) => ['-i', f]), '-filter_complex', `${strips.map((_, i) => `[${i}]`).join('')}vstack=inputs=${strips.length}`, path.resolve(out)]);
  await rm(tmp, { recursive: true, force: true });
  console.log(`wrote ${path.resolve(out)}: reference on top, yours below, at ${n} moments`);
}

// a reference video above your film: the same moments, or the moments --map / --shift / --ref-times give
async function againstVideo() {
  const { sheet, probe, still } = await import('./study.mjs');
  const size = opt('size', '16:9'), tag = size.replace(':', 'x');
  const times = (opt('times') ? opt('times') : await keyTimesOf(filmDir)).split(',').map(Number);
  let refTimes;
  if (opt('ref-times')) refTimes = opt('ref-times').split(',').map(Number);
  else if (opt('map')) {
    const pairs = opt('map').split(',').map((p) => p.split(':').map(Number)).sort((a, b) => a[0] - b[0]);
    refTimes = times.map((t) => { let m = pairs[0]; for (const p of pairs) if (t >= p[0] - 1e-9) m = p; return m[1] + (t - m[0]); });
  } else refTimes = times.map((t) => t + Number(opt('shift', 0)));
  if (refTimes.length !== times.length) { console.error(`--ref-times has ${refTimes.length} moments, your film ${times.length}`); process.exit(1); }
  const info = probe(refDir);
  const tmp = path.join(os.tmpdir(), `compare-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(path.join(tmp, 'a'), { recursive: true });
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  for (const [i, t] of refTimes.entries()) await still(refDir, Math.min(t, info.duration - 1 / info.fps), path.join(tmp, 'a', `${String(i).padStart(3, '0')}.png`), info.fps);
  await run('node', [path.join(here, 'render.mjs'), filmDir, '--size', size, '--times', times.join(','), '--out', path.join(tmp, 'b')]);
  const cols = Math.min(6, times.length), rows = [];
  for (let r = 0; r * cols < times.length; r++) {
    const idx = times.map((_, i) => i).slice(r * cols, r * cols + cols);
    rows.push({ cells: idx.map((i) => ({ file: path.join(tmp, 'a', `${String(i).padStart(3, '0')}.png`), label: `reference ${refTimes[i].toFixed(2)} s · f${Math.round(refTimes[i] * info.fps)}` })) });
    rows.push({ cells: idx.map((i) => ({ file: path.join(tmp, 'b', `${tag}-stills`, `${String(i).padStart(3, '0')}.png`), label: `yours ${times[i].toFixed(2)} s · f${Math.round(times[i] * 60)}` })) });
  }
  await sheet(rows, path.resolve(out), { width: 320, cols });
  await rm(tmp, { recursive: true, force: true });
  console.log(`wrote ${path.resolve(out)}: the reference video on top, your film (${size}) below, at ${times.length} moments`);
}

// a film's key times, read from its index.html (keyTimes: [ ... ])
async function keyTimesOf(dir) {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(path.join(dir, 'index.html'), 'utf8');
  const m = html.match(/keyTimes:\s*\[([^\]]*)\]/);
  if (!m) { console.error(`${dir} has no keyTimes; pass --times`); process.exit(1); }
  return m[1].split(',').map((x) => x.trim()).filter(Boolean).join(',');
}
