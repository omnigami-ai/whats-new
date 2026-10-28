// Measure how much a film moves from frame to frame, to check that a move is one smooth curve: no flat stop in the
// middle of it and no jump.
//
//   node scripts/motion.mjs <film.mp4> <from s> <to s>
//
// Prints each frame's mean change (0-255, on a small greyscale copy) as a bar, then flags:
//   stop   the change falls near zero between two moving stretches (a move that parks, then starts again), counting a
//          slow drift (> 0.3) as moving: a push that settles, then creeps on, has stopped in between
//   halt   a steady move, a slow drift included, drops to near zero in one frame (it ends without settling)
//   jump   the change more than doubles from one frame to the next while moving (a jolt), cuts aside (> 25)
import { execFileSync } from 'node:child_process';

const [file, from, to] = process.argv.slice(2);
if (!file || from === undefined || to === undefined) { console.error('usage: node scripts/motion.mjs <film.mp4> <from s> <to s>'); process.exit(1); }
const w = 240, h = 136, n = w * h;
const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', from, '-t', String(+to - +from), '-i', file, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
const frames = [];
for (let o = 0; o + n <= raw.length; o += n) frames.push(raw.subarray(o, o + n));
const d = [];
for (let i = 1; i < frames.length; i++) { let s = 0; for (let k = 0; k < n; k++) s += Math.abs(frames[i][k] - frames[i - 1][k]); d.push(s / n); }
// the film's own frame rate (a 60 fps film measured at 30 printed every time doubled)
const rate = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file]).toString().trim().split('/');
const fps = Number(rate[0]) / Number(rate[1] || 1), flags = [];
d.forEach((v, i) => {
  const t = (+from + (i + 1) / fps).toFixed(2);
  console.log(`${t}  ${v.toFixed(2).padStart(6)}  ${'#'.repeat(Math.min(80, Math.round(v * 4)))}`);
  if (v > 25) return; // a cut
  // the twelve frames either side, within this shot (never across a cut)
  const before = d.slice(Math.max(0, i - 12), i), after = d.slice(i + 1, i + 13);
  const lastCut = before.findLastIndex((x) => x > 25), nextCut = after.findIndex((x) => x > 25);
  if (lastCut >= 0) before.splice(0, lastCut + 1);
  if (nextCut >= 0) after.splice(nextCut);
  if (v < 0.15 && before.some((x) => x > 0.3) && after.some((x) => x > 0.3)) flags.push(`stop at ${t} s`);
  if (i > 1 && v < 0.15 && d[i - 1] > 0.3 && v < 0.1 * d[i - 1] && d[i - 2] >= 0.7 * d[i - 1] && d[i - 2] <= 25) flags.push(`halt at ${t} s (${d[i - 1].toFixed(2)} -> ${v.toFixed(2)})`);
  if (i > 0 && d[i - 1] > 0.5 && v > 2.2 * d[i - 1] && v > 1.5) flags.push(`jump at ${t} s (${d[i - 1].toFixed(2)} -> ${v.toFixed(2)})`);
});
console.log(flags.length ? `\n${flags.join('\n')}` : '\nsmooth: no stop, halt or jump');
