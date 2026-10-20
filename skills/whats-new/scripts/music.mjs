// A deterministic synth-pop score for films cut to a beat grid: every film gets its own song, and the song
// develops through the film.
//
// A film describes its score (window.template.music):
//   { bpm, duration, sections: [{ from, to (bars, may be fractional), kick, hats, clap, bass, pad, lead (levels 0–1), riser }],
//     breaks: [[from, to] seconds]  drums, bass and lead drop out; the comp plays on, 3.5 dB up (a final break ends the song),
//     seed  optional: picks the song (default: the film's folder name, which render.mjs passes as `film`),
//     keyRange: [lo, hi]  optional MIDI range for the key's root (default G2–E3),
//     bpmRange: [lo, hi]  optional: the seed picks the tempo in it (only for films not cut to a fixed grid),
//     palette: { lead, pad }  optional: fix the lead (bell, pluck, square, mallet) or pad (saw, pulse, glass),
//     harmony: 'film'  optional: play the film's own `root` and `chords` instead of a seeded progression,
//     ending: { at (s), chord: [semitones] }  optional: where the landing hit falls, and its chord }
// and render.mjs --music turns it into audio. Same film, same samples, every time: choices come from a seeded
// generator, noise is a hash of the sample index, every voice is closed-form or a filter run in order, and
// nothing reads a clock. (`root` and `chords` stay valid; with the default harmony they're not used.)
//
// The song (songOf): the seed picks one of twelve pop progression sets (an A for the verse, a B for the lift;
// eight major, four minor), the key, a motif (a rhythm cell, chord tones on strong beats, steps between, one
// leap and back), a kick family, hat, bass and chord-rhythm orders, and the lead and pad instruments.
// The form: the film's sections become intro, A (verse), B (lift, when the energy rises) and interlude, of at
// most 8 bars. Every 4 bars something changes (the bass pattern, the hats between eighths and sixteenths, the
// lead's entry); every 8 the chord rhythm (plucks, stabs, pulses, or a dotted swell under an arpeggio) and the
// section. The comp re-voices every hit (a low root, the body under a moving top note, dyads, passing notes), so
// no two hits in a row play the same notes; every other bar it pushes the next chord on the last eighth, with the
// bass. Intros play a soft arpeggio, and inside a held pad chord one voice steps to a neighbour and back.
// The melody states its motif, answers it, develops it and cadences; the lift raises it a third and adds a slow
// counter-line. On the last bar of 8, or before a new section, a turnaround: three flat ghost snares and a bass
// walk to the next root.
// The sound is measured from our own reference songs (tools/sound/score-study.md), as production craft only,
// and kept darker than them: a clean kick that sweeps ~200 → 45 Hz and is gone in ~0.2 s; a layered clap on 2
// and 4; dark hats; filter-plucked bass; detuned-saw chords low-passed with gentle key-tracking, voiced round E4;
// a lead round C4–C5 with weak upper partials; a short room; the kick ducking bass, chords and room a few dB; a
// master with gentle glue compression, a 1.5 dB high-shelf tilt down from 7 kHz, −14 LUFS under −1 dBTP, and no
// saturation anywhere.
// Ending: one landing hit (kick, bass, the home chord), then the pad holds that chord and closes through a
// low-pass (12 kHz → 300 Hz) while it fades, like song.mjs closes a song. The landing is `ending.at`, or the beat
// a final break starts on, or where the last kick section ends (if before the last 0.75 s), or else the last bar
// line at least 3.5 s (45% of a short film) before the end.
//
//   compose(score) → Float32Array (the mono fold-down) with .left and .right (the stereo mix), and .info (the
//   song, the bar-by-bar plan, loudness); compose(score, { stems: true }) also returns .stems
//   { drums, bass, chords, lead, room } as [L, R]; songOf(score) → the song alone
//   wav(buf) → a 16-bit WAV, stereo when buf has .left/.right
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const TAU = 2 * Math.PI;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// the master: −14 LUFS with true peaks about 11 dB over it (the reference songs sit at 10–12 dB), so the render's
// loudness pass (−2.5 dBTP) stays linear; the limiter may take up to 8 dB off the loudest peak (about what the
// songs' own masters take off theirs), and a sparse score that would need more is left quieter, not squashed
// the organic and felt buses, set against the synth's stem balance (score-study.md)
const STYLE_GAIN = { organic: { chords: 1.13, lead: 0.22 }, felt: { chords: 0.95, lead: 0.5 } };
export const LUFS = -14, CEILING_DBTP = -1, PLR = 10.8, MAX_CUT = 8;

// seeded noise, closed-form: the same value for the same (index, seed) on every render
function hash(i, seed) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}
// the old LCG, kept for the (legacy) riser
function noise(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

// band-limited saw (polyBLEP); p is the phase in [0, 1), dt the phase step
function saw(p, dt) {
  let v = 2 * p - 1;
  if (p < dt) { const x = p / dt; v -= x + x - x * x - 1; } else if (p > 1 - dt) { const x = (p - 1) / dt; v -= x * x + x + x + 1; }
  return v;
}

// a state-variable filter (topology-preserving transform): stable while its cutoff moves
class SVF {
  constructor(fc = 1000, q = 0.707) { this.s1 = 0; this.s2 = 0; this.set(fc, q); }
  set(fc, q) {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), SR * 0.45) / SR);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  run(x) {
    const v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    this.bp = v1; this.hp = x - this.k * v1 - v2; this.lp = v2;
    return v2;
  }
}

// RBJ biquad shelves and filters, run in place over a whole channel
function biquad(x, type, f, q = 0.707, gainDb = 0) {
  const w = TAU * f / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  else {
    const sq = 2 * Math.sqrt(A) * al, s = type === 'low' ? -1 : 1;
    b0 = A * ((A + 1) + s * (A - 1) * cs + sq); b1 = -2 * s * A * ((A - 1) + s * (A + 1) * cs); b2 = A * ((A + 1) + s * (A - 1) * cs - sq);
    a0 = (A + 1) - s * (A - 1) * cs + sq; a1 = 2 * s * ((A - 1) - s * (A + 1) * cs); a2 = (A + 1) - s * (A - 1) * cs - sq;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

// ---- loudness (ITU-R BS.1770-4, gated) and true peak (4× oversampled), for the master

const K1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const K2 = [1, -2, 1, -1.99004745483398, 0.99007225036621];
function kWeight(x) {
  const y = new Float64Array(x.length);
  let src = x;
  for (const [b0, b1, b2, a1, a2] of [K1, K2]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = src[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
    }
    src = y;
  }
  return y;
}
export function loudness(L, R) {
  const kl = kWeight(L), kr = kWeight(R), blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), z = [];
  for (let a = 0; a + blk <= kl.length; a += hop) {
    let s = 0; for (let i = a; i < a + blk; i++) s += kl[i] * kl[i] + kr[i] * kr[i];
    z.push(s / blk);
  }
  const lk = (p) => -0.691 + 10 * Math.log10(p);
  const abs = z.filter((p) => lk(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((p) => lk(p) > rel);
  return lk(g.reduce((a, b) => a + b, 0) / g.length);
}
// 4× interpolation taps (Kaiser-windowed sinc, 16 per phase, unit gain at DC), for the inter-sample peaks
const TP_N = 16, TP_TAPS = [1, 2, 3].map((ph) => {
  const bessel = (x) => { let s = 1, t = 1; for (let k = 1; k < 20; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const t = [];
  for (let k = 0; k < TP_N; k++) {
    const x = k - (TP_N / 2 - 1) - ph / 4, r = x / (TP_N / 2);
    const w = Math.abs(r) >= 1 ? 0 : bessel(8 * Math.sqrt(1 - r * r)) / bessel(8);
    t.push((x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w);
  }
  const sum = t.reduce((a, b) => a + b, 0);
  return t.map((v) => v / sum);
});
function peakTrace(x) { // per sample: the highest |value| on the 4× grid from this sample to the next
  const n = x.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = Math.abs(x[i]);
    for (const taps of TP_TAPS) {
      let s = 0;
      for (let k = 0; k < TP_N; k++) { const j = i - (TP_N / 2 - 1) + k; if (j >= 0 && j < n) s += x[j] * taps[k]; }
      if (Math.abs(s) > m) m = Math.abs(s);
    }
    out[i] = m;
  }
  return out;
}
export function truePeak(L, R) {
  let m = 0; for (const ch of [L, R]) { const p = peakTrace(ch); for (let i = 0; i < p.length; i++) if (p[i] > m) m = p[i]; }
  return 20 * Math.log10(Math.max(m, 1e-12));
}
// a clean look-ahead limiter: the gain never rises above what keeps every (true) peak under the
// ceiling, reaches it over 3 ms before the peak, and recovers over ~120 ms; no clipping, no waveshaping
function limit(L, R, ceilingDb) {
  const n = L.length, c = 10 ** (ceilingDb / 20), pl = peakTrace(L), pr = peakTrace(R), g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(pl[i], pr[i]); g[i] = p > c ? c / p : 1; }
  const W = Math.round(0.003 * SR);
  const minf = movingMin(g, W);
  // box-average the minimum over the same span: still at or under every sample's need, but smooth
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + minf[i];
  const avg = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - W), b = Math.min(n, i + W + 1); avg[i] = (pre[b] - pre[a]) / (b - a); }
  const rel = 1 - Math.exp(-1 / (0.12 * SR));
  let r = 1, sum = 0, max = 0;
  for (let i = 0; i < n; i++) {
    r = Math.min(avg[i], r + (1 - r) * rel);
    const d = -20 * Math.log10(r); sum += d; if (d > max) max = d;
    L[i] *= r; R[i] *= r;
  }
  return { mean: sum / n, max };
}
function movingMin(g, W) { // min over [i − W, i + W]
  const n = g.length, out = new Float32Array(n), dq = new Int32Array(n + 2 * W + 2);
  let h = 0, t = 0;
  for (let i = 0; i < n + W; i++) {
    if (i < n) { while (t > h && g[dq[t - 1]] >= g[i]) t--; dq[t++] = i; }
    const j = i - W;
    if (j >= 0) { while (dq[h] < j - W) h++; out[j] = g[dq[h]]; }
  }
  return out;
}

// ---- the song's vocabulary (all chords diatonic, as semitones from the key's root)

const MAJ = { I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16] };
const MIN = { i: [0, 3, 7], III: [3, 7, 10], iv: [5, 8, 12], v: [7, 10, 14], VI: [8, 12, 15], VII: [10, 14, 17] };
const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
// pop progressions, an A (verse) and a B (lift) each; the seed picks one set a film
export const PROGRESSIONS = [
  { mode: 'major', A: 'I V vi IV', B: 'IV V iii vi' },
  { mode: 'major', A: 'vi IV I V', B: 'IV I V V' },
  { mode: 'major', A: 'I vi IV V', B: 'IV V I vi' },
  { mode: 'major', A: 'I IV vi V', B: 'vi IV V V' },
  { mode: 'major', A: 'I iii IV V', B: 'vi V IV V' },
  { mode: 'major', A: 'IV I V vi', B: 'IV V vi I' },
  { mode: 'major', A: 'I V IV V', B: 'vi IV I V' },
  { mode: 'major', A: 'vi V IV V', B: 'I V vi IV' },
  { mode: 'minor', A: 'i VI III VII', B: 'iv VI III VII' },
  { mode: 'minor', A: 'i VII VI VII', B: 'VI VII i i' },
  { mode: 'minor', A: 'i iv VI v', B: 'VI III VII i' },
  { mode: 'minor', A: 'VI VII i i', B: 'iv v VI VII' },
];
// the lead's rhythm cells: onsets in eighths within a bar, straight
const CELLS = [[0, 2, 3, 4, 6], [0, 1, 2, 4, 6], [0, 2, 4, 5, 6], [0, 3, 4, 6], [0, 1, 3, 4, 6], [0, 2, 3, 5, 6], [0, 4, 5, 6], [0, 2, 4, 6, 7]];
const BASS = ['offbeat', 'eighths', 'synco', 'octave'];
const CHORDS = ['pluck', 'stab', 'pulse', 'held'];
// the comp's top line: offsets through the chord tones, one per hit that carries a top (neighbours always differ)
const TOPS = [[0, 1, 2, 1, 0, 1, 2, 3], [2, 1, 0, 1, 2, 1, 0, -1], [0, 2, 1, 0, -1, 0, 1, 2], [1, 0, 1, 2, 3, 2, 1, 0], [0, -1, 0, 1, 2, 1, 2, 0]];
// the arpeggio: offsets through the chord tones, one per eighth
const ARPS = [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 1, 3, 2, 4, 2], [4, 3, 2, 1, 0, 1, 2, 3], [0, 2, 4, 2, 1, 3, 5, 3]];
const DRUMS = ['four', 'push', 'electro', 'skip'];
const HATS = ['eighths', 'offbeats', 'sixteenths'];
// no square lead or pulse pad: square and pulse waves are what made the score sound like an old game console
const LEADS = ['bell', 'pluck', 'mallet'];
const PADS = ['saw', 'glass'];
// the sound: 'synth' (oscillators), 'organic' (plucked strings, a marimba, a shaker) or 'felt' (a soft piano and a
// sub bass over a minimal kit: kick, rim, shaker)
export const STYLES = ['synth', 'organic', 'felt'];

// string hash and a small seeded generator: the same film name gives the same choices on every render
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(s) {
  let a = hashStr(s);
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b); a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35); a ^= a >>> 16; // finalise: similar names, unrelated seeds
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next(); next();
  return next;
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const shuffle = (r, a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// the song a score will play: its key, progressions, motif, patterns and palette (exported for tests and the A/B)
export function songOf(score) {
  const name = score.seed !== undefined ? score.seed : score.film !== undefined ? score.film : 'omnigami';
  const R = (k) => rng(`${name}:${k}`);
  let root, mode, A, B;
  if (score.harmony === 'film') {
    const ch = score.chords || [[0, 4, 7]];
    root = score.root !== undefined ? score.root : 45; mode = ch[0][1] - ch[0][0] === 3 ? 'minor' : 'major';
    A = ch; B = ch.length >= 4 ? [...ch.slice(2), ...ch.slice(0, 2)] : ch;
  } else {
    // major keys only: the founder found the minor sets off under product films (2026-10-20)
    const set = pick(R('progression'), PROGRESSIONS.filter((x) => x.mode === 'major')), T = set.mode === 'major' ? MAJ : MIN;
    mode = set.mode; A = set.A.split(' ').map((c) => T[c]); B = set.B.split(' ').map((c) => T[c]);
    const [lo, hi] = score.keyRange || [43, 52];
    root = lo + Math.floor(R('key')() * (hi - lo + 1));
  }
  const bpm = score.bpmRange ? score.bpmRange[0] + Math.floor(R('tempo')() * (score.bpmRange[1] - score.bpmRange[0] + 1)) : score.bpm;
  const rm = R('motif'), cells = shuffle(rm, CELLS);
  const motif = { a: cells[0], b: cells[1], dir: rm() < 0.5 ? 1 : -1, leapAt: 1 + Math.floor(rm() * (cells[0].length - 2)), leap: rm() < 0.5 ? 3 : 4, start: pick(rm, [2, 4, 7]), arch: rm() < 0.6 };
  const bass = shuffle(R('bass'), BASS), chords = shuffle(R('chords'), CHORDS.filter((c) => c !== 'held'));
  const lead = (score.palette && score.palette.lead) || pick(R('lead'), LEADS);
  const rc = R('comp');
  return {
    name, root, mode, A, B, bpm, motif, bass, chords: [chords[0], chords[1], chords[2], 'swell'], tops: shuffle(rc, TOPS).slice(0, 2), arp: pick(rc, ARPS),
    drums: pick(R('drums'), DRUMS), hats: pick(R('hats'), HATS), lead, counter: lead === 'mallet' ? 'bell' : 'mallet', style: STYLES.includes(score.style) ? score.style : 'synth', pad: (score.palette && score.palette.pad) || pick(R('pad'), PADS),
    home: mode === 'major' ? MAJ.I : MIN.i,
  };
}

// ---- the score

export function compose(score, opts = {}) {
  const song = songOf(score);
  const { duration, sections = [], breaks = [] } = score;
  const { root, mode, bpm, motif } = song;
  const beat = 60 / bpm, bar = beat * 4, n = Math.ceil(duration * SR), D = duration;
  const scale = SCALE[mode];
  const stereo = () => [new Float32Array(n), new Float32Array(n)];
  const bus = { kick: stereo(), clap: stereo(), hats: stereo(), bass: stereo(), chords: stereo(), pad: stereo(), lead: stereo(), fx: stereo() };
  const send = new Float32Array(n); // mono send into the room
  const kicks = [];
  const at = (bars) => sections.find((s) => bars >= s.from - 1e-9 && bars < s.to - 1e-9) || {};
  const atT = (t) => at(t / bar + 1e-9);
  const inBreak = (t) => breaks.some(([a, b]) => t >= a - 1e-6 && t < b - 1e-6);
  const leadLevel = (s) => (s.lead !== undefined ? s.lead : s.kick > 0 ? 0.6 : 0);
  const energy = (s) => (s.kick || 0) + (s.clap || 0) + (s.hats || 0) + (s.bass || 0) + (s.pad || 0);
  const bars = Math.ceil(D / bar);

  // ---- where the ending lands
  const kickSecs = sections.filter((s) => s.kick > 0);
  const tailLen = Math.min(3.5, D * 0.45);
  const finalBreak = breaks.filter(([, b]) => b >= D - 0.1).sort((x, y) => x[0] - y[0])[0];
  let land = null;
  if (score.ending && score.ending.at !== undefined) land = score.ending.at;
  else if (kickSecs.length && finalBreak) land = Math.floor((finalBreak[0] + 0.02) / beat) * beat;
  else if (kickSecs.length) {
    const end = Math.min(D, Math.max(...kickSecs.map((s) => s.to * bar)));
    if (end <= D - 0.75) land = end;
    else { const T = Math.floor((D - tailLen) / bar + 1e-6) * bar; if (T >= bar) land = T; }
  }
  let tail = land;
  if (tail === null) { // no kick: the pad just closes over the last section (or the last few seconds)
    const last = sections.reduce((m, s) => (s.from * bar < D && s.from > (m ? m.from : -1) ? s : m), null);
    tail = Math.max(Math.floor((D - tailLen) / bar + 1e-6) * bar, last ? last.from * bar : 0);
    if (tail > D - 0.5) tail = Math.max(0, D - tailLen);
  }
  const live = (t) => (land === null || t < land - 1e-6) && !inBreak(t) && t < D;
  const before = land !== null ? atT(Math.max(0, land - 1e-3)) : {};
  const homeChord = (score.ending && score.ending.chord) || song.home;
  const landBar = land !== null ? land / bar : Infinity;

  // ---- the form: the film's sections become song sections (intro, A, B, interlude) of at most 8 bars;
  // a section that lifts the energy is a B (the lift progression), one that drops it an A
  const cuts = new Set([0]);
  for (const s of sections) for (const v of [s.from, s.to]) { const b = Math.floor(v + 1e-9); if (b > 0 && b < bars) cuts.add(b); }
  const starts = [...cuts].sort((a, b) => a - b);
  const blocks = [];
  starts.forEach((a, i) => {
    const z = i + 1 < starts.length ? starts[i + 1] : bars;
    for (let s = a; s < z; s += 8) blocks.push({ from: s, to: Math.min(z, s + 8), split: s > a });
  });
  let seen = false, prevE = 0, prevLabel = 'A';
  for (const bl of blocks) {
    const s = at(bl.from + 1e-9), E = energy(s);
    if (!(s.kick > 0)) bl.label = seen ? 'interlude' : 'intro';
    else if (!seen) bl.label = 'A';
    else if (bl.split) bl.label = prevLabel === 'A' ? 'B' : 'A';
    else bl.label = E > prevE + 0.05 ? 'B' : E < prevE - 0.05 ? 'A' : prevLabel === 'A' ? 'B' : 'A';
    if (s.kick > 0) { seen = true; prevE = E; prevLabel = bl.label; }
  }
  // at least two progressions in a film: a lone A long enough is split, its second half the lift
  const grooves = blocks.filter((b) => b.label === 'A' || b.label === 'B');
  if (grooves.length && !grooves.some((b) => b.label === 'B')) {
    const g = grooves.reduce((m, b) => (Math.min(b.to, landBar) - b.from > Math.min(m.to, landBar) - m.from ? b : m));
    const len = Math.min(g.to, Math.floor(landBar)) - g.from;
    if (len >= 4) { const mid = g.from + (len >= 8 ? 4 : Math.floor(len / 2)); blocks.splice(blocks.indexOf(g) + 1, 0, { from: mid, to: g.to, label: 'B' }); g.to = mid; }
  }
  // each bar: its section, place in the section (runs of one label count on), chord and role
  const plan = [];
  for (let k = 0; k < blocks.length; k++) {
    const bl = blocks[k], prev = blocks[k - 1];
    bl.run = prev && prev.label === bl.label ? prev.run : bl.from;
    for (let b = bl.from; b < bl.to; b++) {
      const rel = b - bl.run, prog = bl.label === 'B' ? song.B : song.A;
      plan[b] = { label: bl.label, rel, phrase: Math.floor(rel / 4), role: rel % 4, chord: prog[rel % prog.length], groove: bl.label === 'A' || bl.label === 'B', blockEnd: b === bl.to - 1 };
    }
  }
  for (const bl of blocks) { const end = blocks.filter((x) => x.run === bl.run && x.label === bl.label).reduce((m, x) => Math.max(m, x.to), bl.to); for (let b = bl.from; b < bl.to; b++) plan[b].runLen = end - bl.run; }
  for (let b = 0; b < bars; b++) {
    const p = plan[b], q = plan[b + 1];
    // a turnaround on the last bar of every 8, and before a new section
    p.fill = p.groove && (p.rel % 8 === 7 || (q && q.label !== p.label)) && b + 1 < landBar;
    p.next = q ? q.chord : p.chord;
    // every other bar the comp and bass push the next chord on the last eighth (not into a turnaround or the landing)
    p.antic = p.groove && !p.fill && p.role % 2 === 1 && p.next.join() !== p.chord.join() && b + 1 < landBar;
  }

  const voicings = new Map();
  let prevVoicing = null;
  const voiceChord = (c, key) => { // close voicing round E4, moving as little as possible from the last chord
    if (voicings.has(key)) return voicings.get(key);
    const pcs = c.map((s) => ((root + s) % 12 + 12) % 12);
    let best = null, bestCost = Infinity;
    for (let lo = 56; lo <= 65; lo++) {
      const v = pcs.map((pc) => lo + ((pc - lo) % 12 + 12) % 12).sort((a, b) => a - b);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      let cost = Math.abs(mean - 64) * 0.6;
      if (prevVoicing && prevVoicing.length === v.length) cost += v.reduce((a, m, i) => a + Math.abs(m - prevVoicing[i]), 0);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
    prevVoicing = best; voicings.set(key, best);
    return best;
  };

  // ---- diatonic helpers for the bass walk and the melody
  const degOf = (semi) => { const o = Math.floor(semi / 12), pc = ((semi % 12) + 12) % 12; let i = scale.indexOf(pc); if (i < 0) i = scale.findIndex((s) => s > pc) - 1; return i + 7 * o; };
  const semiOf = (d) => 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  const chordDegs = (c) => c.map((s) => ((degOf(s) % 7) + 7) % 7);
  const isTone = (d, c) => chordDegs(c).includes(((d % 7) + 7) % 7);
  const snap = (d, c, dir = 1) => { for (let k = 0; k < 4; k++) { if (isTone(d + k * dir, c)) return d + k * dir; if (isTone(d - k * dir, c)) return d - k * dir; } return d; };
  const leadBase = root + 12 * Math.ceil((55 - root) / 12); // the lead's degree 0: the key's root in G3–F#4
  const LO = 0, HI = 8; // the lead's range in degrees over it: mostly C4–C5

  // ---- instruments: each writes one event into its bus
  const put = (b, i, l, r) => { if (i >= 0 && i < n) { b[0][i] += l; b[1][i] += r; } };
  function kick(t, g) {
    kicks.push(t);
    const s0 = Math.round(t * SR), len = Math.round(0.32 * SR), cl = new SVF(3400, 1.1);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const u = i / SR;
      ph += TAU * (44 + 70 * Math.exp(-u / 0.024) + 90 * Math.exp(-u / 0.0025)) / SR;
      const amp = (1 - Math.exp(-u / 0.0004)) * Math.exp(-((u / 0.0866) ** 1.74));
      cl.run(hash(i, 7)); // the beater: a 1 ms band of noise round 3.4 kHz, clean
      const v = ((Math.sin(ph) + 0.025 * Math.sin(2 * ph)) * amp + cl.bp * Math.exp(-u / 0.0012) * 0.4) * g;
      put(bus.kick, s0 + i, v, v);
    }
  }
  function clap(t, g, seed) {
    const s0 = Math.round(t * SR), len = Math.round(0.3 * SR);
    const bl = new SVF(1150, 0.9), br = new SVF(1150, 0.9), hl = new SVF(4000, 0.7), hr = new SVF(4000, 0.7);
    const bursts = [[0, 0.8], [0.0098, 0.7], [0.0187, 1]];
    for (let i = 0; i < len; i++) {
      const u = i / SR;
      let e = 0; for (const [o, a] of bursts) if (u >= o) e = Math.max(e, a * Math.exp(-(u - o) / 0.0022));
      if (u >= 0.0187) e = Math.max(e, 0.6 * Math.exp(-(u - 0.0187) / 0.055));
      const a = hash(i, seed), b = hash(i, seed + 1), nl = a, nr = 0.75 * a + 0.66 * b;
      bl.run(nl); br.run(nr); hl.run(nl); hr.run(nr);
      const body = Math.sin(TAU * 190 * u) * Math.exp(-u / 0.03) * 0.07;
      const l = (bl.bp + hl.hp * 0.18) * e + body, r = (br.bp + hr.hp * 0.18) * e + body;
      put(bus.clap, s0 + i, l * g, r * g);
      send[s0 + i] += (l + r) * 0.5 * g;
    }
  }
  // a quiet snare for the turnarounds: a short band of noise round 1.8 kHz on a 185 Hz body, no toms
  function snare(t, g, seed) {
    const s0 = Math.round(t * SR), len = Math.round(0.12 * SR), bp = new SVF(1800, 0.8);
    for (let i = 0; i < len; i++) {
      const u = i / SR; bp.run(hash(i, seed));
      const v = (bp.bp * Math.exp(-u / 0.025) + Math.sin(TAU * 185 * u) * Math.exp(-u / 0.03) * 0.35) * g * Math.min(1, u / 0.0005);
      put(bus.clap, s0 + i, v, v * 0.95);
      send[s0 + i] += v * 0.5;
    }
  }
  // 808-style metal under the noise, darker than v2: high-passed 6.5 kHz, low-passed 11 kHz
  const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.71);
  function hat(t, g, seed, open) {
    const s0 = Math.round(t * SR), len = Math.round((open ? 0.16 : 0.09) * SR);
    const hp = new SVF(6500, 0.7), hp2 = new SVF(6500, 0.7), lp = new SVF(11000, 0.7), bp = new SVF(7500, 1.1);
    for (let i = 0; i < len; i++) {
      const u = i / SR, e = Math.exp(-u / (open ? 0.03 : 0.011)) * Math.min(1, u / 0.0005);
      let m = 0; for (const f of METAL) m += (f * u) % 1 < 0.5 ? 1 : -1;
      hp.run(hash(i, seed)); hp2.run(hp.hp); lp.run(hp2.hp); bp.run(m / 6);
      const v = (lp.lp * 0.8 + bp.bp * 0.4) * e * g;
      put(bus.hats, s0 + i, v * 0.94, v);
      send[s0 + i] += v * 0.05;
    }
  }
  function bass(t, midi, g, dur, round = false) {
    const s0 = Math.round(t * SR), long = dur > 0.6, len = Math.round((dur + 0.02) * SR), f = hz(midi), dt = f / SR;
    const f1 = new SVF(), f2 = new SVF();
    let p1 = 0.5, p2 = 0.125, ps = 0; // the phases that give the lowest crest through the filter (7 dB, not 12)
    for (let i = 0; i < len; i++) {
      const u = i / SR;
      if (i % 16 === 0) { const fc = round ? 240 + 650 * Math.exp(-u / 0.05) : 380 + 1300 * Math.exp(-u / 0.06); f1.set(fc, 1.0); f2.set(fc, 0.6); }
      p1 = (p1 + dt) % 1; p2 = (p2 + 2 * dt) % 1; ps += TAU * f / SR;
      const y = f2.run(f1.run(saw(p1, dt) * 0.6 + saw(p2, 2 * dt) * 0.5 + Math.sin(ps) * 0.45));
      const env = Math.min(1, u / 0.005) * (long ? 0.6 * Math.exp(-u / 0.09) + 0.4 * Math.exp(-u / 0.45) : 0.2 * Math.exp(-u / 0.04) + 0.8 * Math.exp(-u / 0.5))
        * Math.min(1, Math.max(0, (dur + 0.02 - u) / 0.02));
      const v = y * env * g;
      put(bus.bass, s0 + i, v, v);
    }
  }
  // chord voices: three saws a note, outer ones hard left and right; low-passed with gentle key-tracking
  const DETUNE = [[-0.12, 1, 0], [0, 0.5, 0.5], [0.12, 0, 1]];
  const CHORD_KIND = { // length (s), filter (floor, sweep, time), amplitude (fast share, fast, slow), attack
    pluck: [0.62, 1400, 2400, 0.08, 0.4, 0.09, 0.42, 0.006],
    stab: [0.24, 1500, 2200, 0.05, 0.6, 0.05, 0.16, 0.004],
    pulse: [0.2, 1400, 1800, 0.05, 0.5, 0.05, 0.14, 0.004],
    swell: [0.8, 1000, 1700, 0.2, 0.3, 0.12, 0.7, 0.014],
    arp: [0.34, 950, 2300, 0.05, 0.55, 0.05, 0.22, 0.003],
    land: [2.2, 1300, 2000, 0.12, 0.55, 0.08, 0.7, 0.006],
  };
  function chordHit(t, notes, g, kind, len) {
    const [L0, fFloor, fSweep, fT, fast, tF, tS, atk] = CHORD_KIND[kind];
    const dur = len || L0, s0 = Math.round(t * SR), n0 = Math.round(dur * SR);
    const kt = Math.sqrt(hz(notes[notes.length - 1]) / 392); // gentle key-tracking from the top note
    const fl = new SVF(), fr = new SVF();
    const osc = notes.flatMap((m, k) => DETUNE.map(([d, gl, gr], j) => ({ dt: hz(m + d) / SR, p: (j / 3 + k * 0.17) % 1, gl, gr })));
    const norm = 1 / Math.sqrt(osc.length);
    for (let i = 0; i < n0; i++) {
      const u = i / SR;
      if (i % 16 === 0) { const fc = (fFloor + fSweep * Math.exp(-u / fT)) * kt; fl.set(fc, 0.7); fr.set(fc, 0.7); }
      let l = 0, r = 0;
      for (const o of osc) { o.p += o.dt; if (o.p >= 1) o.p -= 1; const v = saw(o.p, o.dt); l += v * o.gl; r += v * o.gr; }
      const env = Math.min(1, u / atk) ** 2 * (fast * Math.exp(-u / tF) + (1 - fast) * Math.exp(-u / tS)) * Math.min(1, (dur - u) / 0.03);
      const a = fl.run(l * norm) * env * g, b = fr.run(r * norm) * env * g;
      put(bus.chords, s0 + i, a, b);
      send[s0 + i] += (a + b) * 0.5 * 0.22;
    }
  }
  // the lead voices, mono-safe (a centred voice; width comes from the room)
  function voice(kind, t, midi, g, gate, busName = 'lead') {
    const s0 = Math.round(t * SR), f = hz(midi), dt = f / SR;
    const len = Math.round((gate + (kind === 'square' ? 0.12 : 0.7)) * SR);
    const lp = new SVF(), lp2 = new SVF();
    let p = 0, p2 = 0.5;
    for (let i = 0; i < len; i++) {
      const u = i / SR, rel = u < gate ? 1 : Math.exp(-(u - gate) / (kind === 'square' ? 0.04 : 0.12));
      let v = 0;
      if (kind === 'bell') { // fewer, weaker upper partials than v2, and they die fast
        v = Math.sin(TAU * f * u) * Math.exp(-u / 0.5) + 0.2 * Math.sin(TAU * 2 * f * u) * Math.exp(-u / 0.18)
          + 0.05 * Math.sin(TAU * 2.76 * f * u) * Math.exp(-u / 0.05) + 0.03 * Math.sin(TAU * 4 * f * u) * Math.exp(-u / 0.03);
        v *= Math.min(1, u / 0.0015);
      } else if (kind === 'mallet') {
        v = (Math.sin(TAU * f * u) * Math.exp(-u / 0.42) + 0.12 * Math.sin(TAU * 3.93 * f * u) * Math.exp(-u / 0.04) + 0.02 * Math.sin(TAU * 9.2 * f * u) * Math.exp(-u / 0.012)) * Math.min(1, u / 0.001);
      } else if (kind === 'pluck') {
        p += dt; if (p >= 1) p -= 1;
        if (i % 16 === 0) { const fc = (650 + 1500 * Math.exp(-u / 0.09)) * Math.sqrt(f / 330); lp.set(fc, 0.7); lp2.set(fc, 0.7); }
        v = lp2.run(lp.run(saw(p, dt))) * (0.5 * Math.exp(-u / 0.1) + 0.5 * Math.exp(-u / 0.45)) * Math.min(1, u / 0.003) * 1.6;
      } else { // a soft square: two saws half a cycle apart, low-passed
        p += dt; if (p >= 1) p -= 1; p2 += dt; if (p2 >= 1) p2 -= 1;
        if (i % 32 === 0) { lp.set(1500 * Math.sqrt(f / 330), 0.6); lp2.set(1500 * Math.sqrt(f / 330), 0.6); }
        v = lp2.run(lp.run(saw(p, dt) - saw(p2, dt))) * 0.55 * (0.6 * Math.exp(-u / 0.25) + 0.4) * Math.min(1, u / 0.004);
      }
      const o = v * rel * g;
      put(bus[busName], s0 + i, o, o);
      send[s0 + i] += o * 0.35;
    }
  }

  // ---- acoustic-like voices for the organic and felt sounds: modal and plucked-string models, no samples
  // a note's edges: a short fade in and, at the end of its buffer, a fade to zero, so no voice starts or stops with a click
  const edge = (u, len, a = 0.001, r = 0.02) => Math.min(1, u / a, Math.max(0, (len - u) / r));
  const panOf = (midi) => { const a = (0.5 + Math.max(-0.4, Math.min(0.4, (midi - 64) / 30))) * Math.PI / 2; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };
  // a soft (felt) piano: stretched partials (inharmonicity B), two strings a note 1.2 cents apart, upper partials
  // dying faster, a dark hammer spectrum that brightens a little with velocity, a felt thump, and a damper after `dur`
  function piano(t, midi, g, dur, busName = 'chords') {
    const s0 = Math.round(t * SR), f = hz(midi), vel = Math.min(1, g), tau0 = 2.2 * 2 ** (-(midi - 60) / 18);
    const lenS = Math.max(Math.min(dur + 0.6, tau0 * 2.5 + 0.3), dur + 0.25), len = Math.round(lenS * SR), [pl, pr] = panOf(midi);
    // the two strings of a note sit a little left and right, so their beating reads as width
    const ps = [];
    let norm = 0;
    for (let k = 1; k <= 18; k++) {
      const fk = k * f * Math.sqrt(1 + 0.00038 * k * k); if (fk > 4500) break;
      const a = Math.exp(-(k - 1) * (0.7 - 0.3 * vel)) / Math.sqrt(k), tau = tau0 / (1 + 0.5 * (k - 1));
      norm += a;
      for (const d of [-0.00035, 0.00035]) { const w = TAU * fk * (1 + d) / SR; ps.push({ cw: Math.cos(w), sw: Math.sin(w), c: 1, s: 0, a: a / 2, r: Math.exp(-1 / (tau * SR)), left: d < 0 }); }
    }
    let th = 0;
    for (let i = 0; i < len; i++) {
      const u = i / SR;
      let vl = 0, vr = 0;
      for (const o of ps) { const c = o.c * o.cw - o.s * o.sw; o.s = o.c * o.sw + o.s * o.cw; o.c = c; if (o.left) vl += o.s * o.a; else vr += o.s * o.a; o.a *= o.r; }
      th += (hash(i, s0 + midi) - th) * 0.12;
      // the felt knock on the way in, and a faint damper brush on the way out
      const env = (1 - Math.exp(-u / 0.0018)) * (u < dur ? 1 : Math.exp(-(u - dur) / 0.16)) * edge(u, lenS, 1e-4, 0.03);
      const knock = th * (Math.min(1, u / 0.0008) * Math.exp(-u / 0.006) * 0.06 * vel + (u >= dur ? Math.exp(-(u - dur) / 0.012) * 0.012 : 0)) * edge(u, lenS, 1e-4, 0.03);
      const l = ((vl * 1.35 + vr * 0.65) / norm * env + knock) * g, r = ((vr * 1.35 + vl * 0.65) / norm * env + knock) * g;
      put(bus[busName], s0 + i, l * pl, r * pr);
      send[s0 + i] += (l + r) * 0.125;
    }
  }
  // a plucked string (Karplus–Strong): a seeded noise burst, darkened by velocity, combed at the pluck point,
  // circulating through a loop with a two-point average and an all-pass for the fine tuning; muted after `dur`
  function pluckString(t, midi, g, dur, busName = 'chords', pan = 0) {
    // the loop's period is L − ½ + the all-pass's delay (kept in 0.1–1.1 samples, where its delay is flat)
    const s0 = Math.round(t * SR), f = hz(midi), P = SR / f, L = Math.floor(P + 0.4), frac = P + 0.5 - L, ap = (1 - frac) / (1 + frac);
    const buf = new Float32Array(L), ex = new Float32Array(L), kx = 0.1 + 0.2 * Math.min(1, g);
    let lp = 0;
    for (let i = 0; i < L; i++) { lp += (hash(i, s0 + midi * 7) - lp) * kx; ex[i] = lp; }
    const pos = Math.max(1, Math.round(L * 0.21));
    let mean = 0; for (let i = 0; i < L; i++) { buf[i] = ex[i] - 0.85 * ex[(i - pos + L) % L]; mean += buf[i] / L; }
    for (let i = 0; i < L; i++) buf[i] -= mean;
    const tau = 1.4 * 2 ** (-(midi - 60) / 24), ring = Math.exp(-1 / (tau * f)), mute = Math.exp(-1 / (0.07 * f));
    const len = Math.round((dur + 0.25) * SR), body = new SVF(Math.min(3200, 1200 + f * 3), 0.6), body2 = new SVF(Math.min(3200, 1200 + f * 3), 0.6);
    const wood = new SVF(190, 2.5), top = new SVF(1050, 1.8); // the instrument's body: an air mode and a top-plate mode
    const gl = Math.SQRT2 * Math.cos((0.5 + pan) * Math.PI / 2), gr = Math.SQRT2 * Math.sin((0.5 + pan) * Math.PI / 2);
    let idx = 0, x1 = 0, y1 = 0;
    for (let i = 0; i < len; i++) {
      const u = i / SR, y = buf[idx], v = (ring + (mute - ring) * Math.min(1, Math.max(0, (u - dur) / 0.008))) * 0.5 * (y + buf[(idx + 1) % L]);
      const a = ap * v + x1 - ap * y1; x1 = v; y1 = a; buf[idx] = a; idx = (idx + 1) % L;
      wood.run(y); top.run(y);
      const o = (body2.run(body.run(y)) + wood.bp * 0.25 + top.bp * 0.2) * g * 1.6 * edge(u, dur + 0.25);
      put(bus[busName], s0 + i, o * gl, o * gr);
      send[s0 + i] += o * 0.15;
    }
  }
  // a marimba: a tuned bar's partials (1, 3.99, 9.2), a woody mallet knock, and the resonator's longer fundamental
  function marimba(t, midi, g, gate, busName = 'lead') {
    const s0 = Math.round(t * SR), f = hz(midi), len = Math.round((Math.max(gate, 0.2) + 0.6) * SR), bp = new SVF(Math.min(4000, f * 5), 1.2);
    const tau = 0.55 * 2 ** (-(midi - 60) / 24);
    for (let i = 0; i < len; i++) {
      const u = i / SR; bp.run(hash(i, s0 + 3));
      // harder hits bring out the upper modes; a mode over 0.45 × the sample rate is left out
      const v = (Math.sin(TAU * f * u) * Math.exp(-u / tau) + (0.14 + 0.12 * Math.min(1, g)) * Math.sin(TAU * 3.99 * f * u) * Math.exp(-u / (tau * 0.16))
        + (9.2 * f < 0.45 * SR ? 0.05 * Math.sin(TAU * 9.2 * f * u) * Math.exp(-u / 0.012) : 0) + bp.bp * Math.exp(-u / 0.007) * 0.35) * edge(u, len / SR, 0.0012, 0.04) * g;
      put(bus[busName], s0 + i, v, v);
      send[s0 + i] += v * 0.2;
    }
  }
  // a shaker: band-passed noise with a soft 4 ms onset (the beads), no metal
  function shaker(t, g, seed) {
    const s0 = Math.round(t * SR), len = Math.round(0.2 * SR), bp = new SVF(5600, 0.9), hp = new SVF(3800, 0.7), lp = new SVF(9000, 0.7);
    for (let i = 0; i < len; i++) {
      const u = i / SR; bp.run(hash(i, seed)); hp.run(bp.bp); lp.run(hp.hp);
      const v = lp.lp * edge(u, 0.2, 0.004) * Math.exp(-u / 0.035) * g * 0.55;
      put(bus.hats, s0 + i, v * 0.9, v);
      send[s0 + i] += v * 0.08;
    }
  }
  // a rim click: two short modes of the shell over a small body, and a 1 ms tick
  function rim(t, g, seed) {
    const s0 = Math.round(t * SR), len = Math.round(0.08 * SR), hp = new SVF(3000, 0.7);
    for (let i = 0; i < len; i++) {
      const u = i / SR; hp.run(hash(i, seed));
      const v = (Math.sin(TAU * 1720 * u) * Math.exp(-u / 0.011) * 0.5 + Math.sin(TAU * 2630 * u) * Math.exp(-u / 0.006) * 0.3 + Math.sin(TAU * 470 * u) * Math.exp(-u / 0.016) * 0.4 + hp.hp * Math.exp(-u / 0.001) * 0.5) * edge(u, 0.08, 0.0005) * g * 0.45;
      put(bus.clap, s0 + i, v, v * 0.96);
      send[s0 + i] += v * 0.6;
    }
  }
  // a round sub bass: a sine with a little second and third harmonic, so a phone still hears the line
  function sub(t, midi, g, dur) {
    const s0 = Math.round(t * SR), f = hz(midi), len = Math.round((dur + 0.03) * SR);
    for (let i = 0; i < len; i++) {
      const u = i / SR, ph = TAU * f * u;
      const v = (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph)) * Math.min(1, u / 0.008) * (0.45 + 0.55 * Math.exp(-u / 0.35)) * Math.min(1, Math.max(0, (dur + 0.03 - u) / 0.025)) * g * 0.75;
      put(bus.bass, s0 + i, v, v);
    }
  }

  // ---- the melody: a motif, then its answer, its development and a cadence; the lift raises it a third
  // and adds a slow counter-line. Strong beats take chord tones, the rest move by step, one leap and back.
  function realise(cell, c, start, dir, opts = {}) {
    let d = snap(start, c, dir), leaped = false;
    const notes = [];
    cell.forEach((e, i) => {
      if (i > 0) {
        if (i === opts.leapAt) { d = snap(d + dir * motif.leap, c, dir); leaped = true; }
        else if (leaped) { d -= dir; leaped = false; }
        else d += dir;
        if ((e === 0 || e === 4) && !isTone(d, c)) d = snap(d, c, dir);
        if (motif.arch && e >= 4 && dir === motif.dir) dir = -dir;
      }
      if (d > HI) { d = snap(HI - 1, c, -1); dir = -1; } else if (d < LO) { d = snap(LO + 1, c, 1); dir = 1; }
      const nextE = i + 1 < cell.length ? cell[i + 1] : 8;
      notes.push({ e, d, len: Math.min(nextE - e, i + 1 < cell.length ? 2 : opts.last || 2) });
    });
    return notes;
  }
  let lastD = motif.start + 2;
  function melodyBar(p) {
    const c = p.chord, lift = p.label === 'B' ? 2 : 0, odd = p.phrase % 2 === 1;
    if (p.role === 0) { const ns = realise(p.label === 'B' ? motif.b : motif.a, c, motif.start + lift, motif.dir, { leapAt: motif.leapAt }); return ns; }
    if (p.role === 1) { const cell = (p.label === 'B' ? motif.b : motif.a).slice(0, -1); return realise(cell, c, lastD, -motif.dir, { last: 3 }); }
    if (p.role === 2) return realise(odd ? motif.b : motif.a, c, motif.start + lift + 2, odd ? -motif.dir : motif.dir, { leapAt: odd ? undefined : motif.leapAt });
    // the cadence: a long chord tone, and every other phrase a two-note pickup into the next bar
    const d = snap(lastD - 1, c, -1), out = [{ e: 0, d, len: 3 }];
    if (odd || p.fill) { const nx = snap(motif.start + lift, p.next, motif.dir); out.push({ e: 6, d: nx - 2 * motif.dir, len: 1 }, { e: 7, d: nx - motif.dir, len: 1 }); }
    return out;
  }

  // ---- the comp: every hit re-voiced, as the reference songs' synths play (score-study.md, v4). A pattern gives
  // each step a shape: F, a low root under the body; B, the body, two chord tones close under the top note; U, the
  // top and the tone under it; L, a low root and fifth; T, a passing note into the next top; A, the arpeggio's next
  // note. The top follows a contour through the chord tones, so no two hits in a row play the same notes.
  const COMP = {
    pluck: [[0, 'F', 0.75], [2, 'U', 1], [3, 'T', 0.45], [6, 'B', 0.95], [8, 'L', 0.6], [10, 'U', 1], [11, 'T', 0.45], [14, 'B', 0.9]],
    stab: [[0, 'F', 1], [3, 'B', 0.8], [6, 'U', 0.9], [8, 'L', 0.7], [10, 'B', 0.85], [12, 'T', 0.55], [14, 'U', 0.85]],
    pulse: [[0, 'L', 0.8], [2, 'B', 0.9], [4, 'U', 0.75], [6, 'B', 0.9], [8, 'L', 0.8], [10, 'B', 0.9], [12, 'U', 0.75], [14, 'B', 0.9]],
    swell: [[0, 'F', 1], [6, 'B', 0.8], [12, 'U', 0.75]], // dotted, each hit held to the next
    arp: [0, 2, 4, 6, 8, 10, 12, 14].map((k, i) => [k, 'A', i % 2 ? 0.7 : 0.9]),
    // the felt piano's, sparser: a few re-voiced chords a bar, and room between them
    dotted: [[0, 'F', 0.85], [6, 'U', 0.6], [10, 'B', 0.7]],
    broken: [[0, 'L', 0.8], [4, 'B', 0.6], [10, 'U', 0.65], [14, 'T', 0.45]],
    offbeat: [[2, 'B', 0.75], [6, 'U', 0.6], [10, 'B', 0.7], [14, 'U', 0.55]],
    halves: [[0, 'F', 0.8], [8, 'B', 0.6]],
  };
  const FELT = { pluck: 'dotted', stab: 'broken', pulse: 'offbeat', swell: 'halves', arp: 'halves' };
  // the organic and felt sounds are played, not sequenced: a few ms early or late and a little louder or softer,
  // the same on every render; a chord of three or more notes rolls upward over 7 ms a note
  const hum = (id, ms) => (ms / 1000) * hash(id, 91);
  function playComp(t, notes, g, kind, len, id) {
    if (song.style === 'synth') return chordHit(t, notes, g, kind, len);
    const n = notes.length;
    notes.forEach((m, i) => {
      const tt = Math.max(0, t + hum(id * 8 + i, song.style === 'felt' ? 6 : 4) + (n > 2 ? i * 0.007 : 0)), gv = (g / Math.sqrt(n)) * (1 + 0.08 * hash(id * 8 + i, 92));
      if (song.style === 'felt') piano(tt, m, gv, len);
      else pluckString(tt, m, gv, len, 'chords', ((i % 3) - 1) * 0.3);
    });
  }
  function playLead(kind, t, midi, g, gate, id, counter = false) {
    if (song.style === 'synth') return voice(kind, t, midi, g, gate);
    const tt = Math.max(0, t + hum(id, 5)), gv = g * (1 + 0.06 * hash(id, 93));
    if (song.style === 'felt') piano(tt, midi + 12, gv * 0.8, gate + 0.2, 'lead');
    else if (counter) pluckString(tt, midi, gv * 0.8, gate, 'lead');
    else marimba(tt, midi, gv, gate);
  }
  const pcsOf = (c) => c.map((s) => ((root + s) % 12 + 12) % 12);
  const ladder = (pcs, lo, hi) => { const o = []; for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) o.push(m); return o; };
  const nearest = (l, m) => l.reduce((bi, x, i) => (Math.abs(x - m) < Math.abs(l[bi] - m) ? i : bi), 0);
  const reflect = (i, len) => { while (i < 0 || i >= len) i = i < 0 ? -i : 2 * (len - 1) - i; return i; };
  const scaleStep = (m, dir) => { let x = m + dir; while (!scale.includes(((x - root) % 12 + 12) % 12)) x += dir; return x; };
  let lastTop = 67, lastArp = 60, prevSet = '';
  function compBar(p, fam) {
    const out = [], contour = song.tops[(p.phrase + (p.label === 'B' ? 1 : 0)) % song.tops.length];
    // the second 8 bars of a section colour its minor chords with their seventh
    const colour = p.groove && Math.floor(p.rel / 8) % 2 === 1;
    const tonesOf = (c) => { const pcs = pcsOf(c); return colour && c[1] - c[0] === 3 ? [...pcs, (pcs[0] + 10) % 12] : pcs; };
    let j = 0, arpBase = null;
    for (const [k, shape, v] of COMP[fam]) {
      const c = p.antic && k >= 14 ? p.next : p.chord, pcs = pcsOf(c), low = ladder([pcs[0]], 50, 61)[0];
      if (shape === 'A') {
        const l = ladder(tonesOf(c), 55, 76);
        if (arpBase === null || k >= 14) { arpBase = nearest(l, lastArp); if (k < 14) lastArp = l[arpBase]; }
        out.push({ k, notes: [l[reflect(arpBase + song.arp[k / 2], l.length)]], v });
      } else if (shape === 'L') out.push({ k, notes: [low, low + 7], v });
      else if (shape === 'T') out.push({ k, notes: null, v });
      else {
        const l = ladder(tonesOf(c), 62, 76), under = ladder(pcs, 52, 76);
        let i = reflect(nearest(l, lastTop) + (j ? contour[j % contour.length] - contour[(j - 1) % contour.length] : 0), l.length);
        const voicing = (t) => { const u = under.filter((m) => m < t - 1); return shape === 'U' ? [u.at(-1), t] : shape === 'B' ? [...u.slice(-2), t] : [low, ...u.slice(-2), t]; };
        let notes = voicing(l[i]);
        if (notes.join() === prevSet) { i = reflect(i + 1, l.length); notes = voicing(l[i]); }
        out.push({ k, notes, v, top: l[i] });
        lastTop = l[i]; j++;
      }
      if (out.at(-1).notes) prevSet = out.at(-1).notes.join();
    }
    // passing notes: a scale step from the side the line comes from, into the next top
    out.forEach((h, i) => {
      if (h.notes) return;
      const prev = out.slice(0, i).reverse().find((x) => x.top), next = out.slice(i + 1).find((x) => x.top);
      const into = next ? next.top : prev ? prev.top : lastTop, from = prev ? prev.top : into;
      h.notes = [scaleStep(into, from > into ? 1 : -1)];
    });
    return out;
  }

  // ---- the arrangement, bar by bar
  const kickSteps = (fam, oddBar) => {
    const k = { four: [[0, 1], [4, 1], [8, 1], [12, 1]], push: [[0, 1], [4, 1], [8, 1], [12, 1]], electro: [[0, 1], [6, 0.7], [8, 1]], skip: [[0, 1], [4, 1], [8, 1], [12, 1]] }[fam];
    if (oddBar && fam === 'push') return [...k, [14, 0.65]];
    if (oddBar && fam === 'electro') return [...k, [14, 0.6]];
    if (oddBar && fam === 'skip') return [...k, [10, 0.55]];
    return k;
  };
  const bassSteps = (fam) => ({ roots: [0, 8, 14], offbeat: [2, 6, 10, 14], eighths: [0, 2, 4, 6, 8, 10, 12, 14], synco: [0, 3, 6, 8, 11, 14], octave: [0, 2, 4, 6, 8, 10, 12, 14] }[fam]);
  const bassMidi = (semi) => { const lo = root + semi - 12; return lo - 12 * Math.floor((lo - 33) / 12); }; // A1–G#2
  const log = [];
  for (let b = 0; b < bars; b++) {
    const p = plan[b], t0 = b * bar, chord = p.chord, notes = voiceChord(chord, chord.join());
    const sb = at(b + 1e-9);
    // the patterns of this bar: the section sets the family, the 8-bar block the variant, the 4-bar phrase the detail
    const block8 = Math.floor(p.rel / 8), lift = p.label === 'B';
    const felt = song.style === 'felt';
    // the bass changes every 4 bars, the chords every 8; the felt sound's sub plays roots in the verse
    const bassFam = !p.groove ? 'offbeat' : felt ? (lift ? 'synco' : 'roots') : song.bass[(lift ? 2 : 0) + (p.phrase % 2)];
    const fam0 = !p.groove ? 'arp' : song.chords[(lift ? 2 : 0) + (block8 % 2)], chordFam = felt ? FELT[fam0] : fam0;
    // the intro's arpeggio is soft; under the swell it's a second, quieter layer
    // the lead's notes first, so the comp can leave room for them
    const lv = leadLevel(sb), leadOn = lv > 0 && p.groove && !(p.label === 'A' && p.rel < 4 && p.runLen >= 8); // a long verse lets the lead in after 4 bars
    const mel = leadOn && !(felt && p.role % 2) ? melodyBar(p) : []; // the felt piano's melody: the motif and its development only
    const leadAt = new Set(mel.filter((nt) => live(t0 + nt.e * beat / 2) && leadLevel(atT(t0 + nt.e * beat / 2)) > 0).map((nt) => nt.e * 2));
    // a cadence bar leaves a beat and a half of space, and where the lead strikes, the comp drops its top note
    const comp = [...compBar(p, chordFam).map((h) => ({ ...h, kind: chordFam, v: h.v * (p.groove ? 1 : 0.6) })),
      ...(chordFam === 'swell' ? compBar(p, 'arp').map((h) => ({ ...h, kind: 'arp', v: h.v * 0.5 })) : [])]
      .filter((h) => !(p.groove && p.role === 3 && h.k >= 4 && h.k <= 10))
      .flatMap((h) => (!leadAt.has(h.k) ? [h] : h.notes.length > 1 ? [{ ...h, notes: h.notes.slice(0, -1) }] : []));
    const denser = song.hats === 'sixteenths' ? 'eighths' : 'sixteenths';
    let hatMode = !p.groove ? (song.hats === 'sixteenths' ? 'eighths' : song.hats) : lift ? 'sixteenths' : p.phrase % 2 ? denser : song.hats;
    if (felt && hatMode === 'sixteenths') hatMode = 'eighths'; // the felt kit stays sparse
    const drumFam = lift && song.drums === 'four' ? 'push' : song.drums;
    log.push({ bar: b, label: p.label, chord: chord.join(), bass: bassFam, chords: chordFam, hats: hatMode, fill: p.fill });
    for (let k = 0; k < 16; k++) {
      const t = t0 + k * beat / 4;
      // in a break the drums, bass and lead stop and the comp plays on, lifted 3.5 dB, as the reference songs'
      // breaks do (score-study.md, v5); the drums and bass come back on the downbeat after it
      if (!((land === null || t < land - 1e-6) && t < D)) continue;
      const brk = inBreak(t), s = atT(t), fillZone = p.fill && k >= 12;
      if (brk) { if (s.pad) playCompAt(k, t, s, 1.5); continue; }
      if (s.kick) for (const [st, v] of kickSteps(drumFam, b % 2 === 1)) if (st === k) kick(t, s.kick * v * (felt ? 0.8 : 1));
      if ((k === 4 || k === 12) && s.clap) (felt ? rim : clap)(t, s.clap, b * 16 + k);
      if (fillZone && !felt && (s.clap || s.kick) && k > 12) snare(t, 0.22 * Math.max(s.clap || 0.5, 0.4), 3000 + b * 16 + k); // ghost notes, flat, no build
      if (s.hats && !(fillZone && k > 12)) {
        let v = 0, open = false;
        if (hatMode === 'offbeats') { if (k % 4 === 2) { v = 0.9; open = true; } }
        else v = k % 4 === 2 ? 0.92 : k % 4 === 0 ? 0.85 : hatMode === 'sixteenths' && s.hats >= 0.45 ? 0.42 : 0;
        if (v && song.style === 'synth') hat(t, s.hats * v * (1 + 0.07 * hash(b * 16 + k, 11)), 1000 + b * 16 + k, open);
        else if (v) shaker(Math.max(0, t + hum(b * 16 + k + 500, 3)), s.hats * v * (open ? 1.15 : 1) * (1 + 0.1 * hash(b * 16 + k, 11)), 1000 + b * 16 + k);
      }
      if (s.bass && bassSteps(bassFam).includes(k)) {
        const steps = bassSteps(bassFam), j = steps.indexOf(k), gap = (steps[j + 1] !== undefined ? steps[j + 1] : 16) - k;
        let m = bassMidi((p.antic && k >= 14 ? p.next : chord)[0]);
        if (bassFam === 'octave' && k % 4 === 2) m += 12;
        else if (bassFam === 'offbeat' && (p.phrase % 2 ? [0, 12, 0, 0] : [0, 0, 12, 0])[j]) m += 12;
        else if (p.phrase % 2 === 1 && k === 14 && bassFam !== 'offbeat') m += 12;
        if (p.fill && k >= 12) { // a walk up (or down) the scale to the next chord's root
          const target = bassMidi(p.next[0]), up = target >= m ? 1 : -1, dT = degOf(target - root), steps2 = k >= 14 ? 1 : 2;
          m = root + semiOf(dT - up * steps2);
        }
        if (felt) sub(t, m, s.bass, Math.min(gap * beat / 4 * 0.85, 1.6 * beat));
        else bass(t, m, s.bass, Math.min(gap * beat / 4 * 0.85, 0.42 * beat * 2), song.style === 'organic');
      }
      if (s.pad) playCompAt(k, t, s, 1);
    }
    function playCompAt(k, t, s, lift) {
      for (const h of comp) if (h.k === k) {
        const next = comp.find((x) => x.kind === h.kind && x.k > k), gap = ((next ? next.k : 16) - k) * beat / 4;
        // each hit stops soon after the next one starts, so the voicings stay apart instead of smearing
        const len = h.kind === 'swell' || h.kind === 'halves' ? Math.min(gap + 0.12, landBar * bar - t + 0.05) : felt ? gap + 0.25 : h.kind === 'arp' && song.style === 'organic' ? gap + 0.2 : Math.min(CHORD_KIND[h.kind] ? CHORD_KIND[h.kind][0] : 0.6, gap + 0.06);
        playComp(t, h.notes, s.pad * h.v * lift, h.kind, len, b * 16 + k + (h.kind === 'arp' ? 7000 : 0));
      }
    }
    // the lead and, in the lift, its counter-line
    if (leadOn) {
      for (const nt of mel) {
        const t = t0 + nt.e * beat / 2;
        if (!live(t)) continue;
        const sl = leadLevel(atT(t));
        if (sl > 0) playLead(song.lead, t, leadBase + semiOf(nt.d), sl, nt.len * beat / 2, b * 16 + nt.e * 2);
        lastD = nt.d;
      }
      if (p.label === 'B') {
        const cd = [snap(lastD - 7 + 2, chord, -1), snap(lastD - 7, chord, 1)];
        if (!felt) for (const [i, d] of cd.entries()) { const t = t0 + i * 2 * beat; if (live(t)) playLead(song.counter, t, leadBase + semiOf(d), lv * 0.55, 1.8 * beat, b * 16 + i * 8 + 3000, true); }
      }
    }
    // legacy: a section can still ask for a riser (the films no longer do)
    if (sb.riser && (b + 1 >= sb.to)) {
      const r = noise(900 + b); let lp = 0;
      for (let i = 0; i < bar * SR; i++) {
        const pp = i / (bar * SR), u = i / SR;
        lp += (r() - lp) * (0.02 + 0.5 * pp * pp);
        const v = (lp * 0.5 + Math.sin(TAU * (200 + 900 * pp * pp) * u) * 0.08) * pp * pp * 0.3;
        put(bus.fx, Math.round(t0 * SR) + i, v, v);
      }
    }
  }
  // the landing hit: kick, bass and the home chord ring out together
  if (land !== null && land < D - 0.05) {
    if (before.kick || kickSecs.length) kick(land, Math.max(before.kick || 0, 0.85));
    if (before.bass) { if (song.style === 'felt') sub(land, bassMidi(homeChord[0]), before.bass, 1.1); else bass(land, bassMidi(homeChord[0]), before.bass, 1.1, song.style === 'organic'); }
    if (song.style === 'synth') chordHit(land, voiceChord(homeChord, 'home'), Math.max(before.pad || 0, 0.6), 'land');
    else { const h = voiceChord(homeChord, 'home'); playComp(land, [h[0] - 12, ...h], Math.max(before.pad || 0, 0.6) * 1.2, 'land', 2.6, 99999); }
  }

  // ---- the sustained pad: in the intro, the lift and the close (not under the verse, so it can enter)
  const padSpans = [];
  {
    let cur = null;
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar, t1 = Math.min(D, t0 + bar);
      if (land !== null && t0 >= land - 1e-6) break;
      const on = plan[b].label !== 'A';
      const end = land !== null ? Math.min(t1, land) : t1;
      const notes = voiceChord(plan[b].chord, plan[b].chord.join());
      if (on && cur && cur.notes === notes && cur.to >= t0 - 1e-6) cur.to = end;
      else { if (cur) padSpans.push(cur); cur = on ? { from: t0, to: end, notes, moves: [] } : null; }
      // inside the bar one voice steps a whole tone to a neighbour on beat 3 and back on the "and" of 4
      // (5 → 6, 1 → 2, or a minor chord's root down to its seventh), so a held chord never sits still
      if (cur) {
        const pcs = pcsOf(plan[b].chord), opts = [];
        notes.forEach((m, k) => { for (const d of [2, -2]) { const x = m + d, pc = x % 12; if (scale.includes(((x - root) % 12 + 12) % 12) && pcs.every((q) => Math.min((pc - q + 12) % 12, (q - pc + 12) % 12) >= 2)) opts.push({ k, d }); } });
        if (opts.length) cur.moves.push({ ...opts[Math.floor((hash(b, 41) * 0.5 + 0.5) * opts.length)], a: t0 + 2 * beat, b: Math.min(end, t0 + 3.5 * beat) });
      }
    }
    if (cur) padSpans.push(cur);
    if (land !== null) padSpans.push({ from: land, to: D, notes: voiceChord(homeChord, 'home'), moves: [] });
  }
  // the organic sound keeps a quieter pad that breathes in slowly; the felt sound has none (the piano rings)
  const PAD_SHARE = { synth: 1, organic: 0.6, felt: 0 }[song.style], padAttack = song.style === 'organic' ? 0.3 : 0.025;
  const padLevel = new Float32Array(n);
  {
    let v = 0; const a = 1 - Math.exp(-1 / (0.03 * SR)), hold = before.pad || (land !== null ? 0.6 : 0);
    for (let i = 0; i < n; i++) {
      const t = i / SR, target = land !== null && t >= land ? hold : atT(t).pad || 0;
      v += (target - v) * a; padLevel[i] = v * PAD_SHARE;
    }
  }
  const padVoices = { saw: [[-0.07, 1, 0.25, 0], [0.07, 0.25, 1, 0]], pulse: [[-0.06, 1, 0.3, 0.3], [0.06, 0.3, 1, 0.3]], glass: [[-0.07, 1, 0.25, 0], [0.07, 0.25, 1, 0], [12, 0.35, 0.35, -1]] }[song.pad];
  if (PAD_SHARE > 0) for (const sp of padSpans) {
    const s0 = Math.round(sp.from * SR), s1 = Math.round(sp.to * SR), rel = Math.round(0.15 * SR);
    const voices = sp.notes.flatMap((m, k) => padVoices.map(([d, gl, gr, w], j) => ({ k, m: m + d, dt: hz(m + d) / SR, to: hz(m + d) / SR, p: hash(k * 3 + j, s0) * 0.5 + 0.5, q: 0, gl, gr, w })));
    for (const o of voices) o.q = (o.p + (o.w > 0 ? 0.5 - o.w : 0)) % 1;
    const fl = new SVF(), fr = new SVF(), norm = 0.6 / Math.sqrt(voices.length), glide = 1 - Math.exp(-1 / (0.035 * SR));
    for (let i = s0; i < Math.min(n, s1 + rel); i++) {
      const u = (i - s0) / SR, t = i / SR;
      if ((i - s0) % 32 === 0) {
        const fc = 1100 + 400 * (0.5 - 0.5 * Math.cos(TAU * t / (4 * bar))); fl.set(fc, 0.6); fr.set(fc, 0.6);
        const mv = sp.moves.find((x) => t >= x.a && t < x.b);
        for (const o of voices) o.to = hz(o.m + (mv && mv.k === o.k ? mv.d : 0)) / SR;
      }
      let l = 0, r = 0;
      for (const o of voices) {
        o.dt += (o.to - o.dt) * glide;
        o.p += o.dt; if (o.p >= 1) o.p -= 1;
        let v;
        if (o.w < 0) v = Math.sin(TAU * o.p) * 0.8; // glass: a sine an octave up
        else if (o.w > 0) { o.q += o.dt; if (o.q >= 1) o.q -= 1; v = saw(o.p, o.dt) - saw(o.q, o.dt); } // pulse
        else v = saw(o.p, o.dt);
        l += v * o.gl; r += v * o.gr;
      }
      const env = Math.min(1, u / padAttack) * (i < s1 ? 1 : Math.max(0, 1 - (i - s1) / rel)) * padLevel[i] * norm;
      const a = fl.run(l) * env, b = fr.run(r) * env;
      bus.pad[0][i] += a; bus.pad[1][i] += b;
      send[i] += (a + b) * 0.5 * 0.25;
    }
  }

  // ---- the room: an 8-line feedback delay network, ~1.1 s, damped, from a high-passed send
  const room = stereo();
  {
    biquad(send, 'hp', 220); biquad(send, 'lp', 7000);
    const lens = [1427, 1601, 1867, 2053, 2311, 2539, 2803, 3109], pre = Math.round(0.016 * SR), rt = { synth: 1.1, organic: 1.3, felt: 1.6 }[song.style];
    const g = lens.map((L) => 10 ** (-3 * L / (rt * SR))), buf = lens.map((L) => new Float32Array(L)), idx = lens.map(() => 0);
    const damp = Math.exp(-TAU * 5200 / SR), lp = lens.map(() => 0);
    const o = new Float32Array(8);
    for (let i = 0; i < n; i++) {
      const x = i >= pre ? send[i - pre] : 0;
      for (let k = 0; k < 8; k++) o[k] = buf[k][idx[k]];
      let sum = 0; for (const v of o) sum += v;
      const h = (2 / 8) * sum;
      let l = 0, r = 0;
      for (let k = 0; k < 8; k++) {
        const fb = (o[k] - h) * g[k];
        lp[k] = fb * (1 - damp) + lp[k] * damp;
        buf[k][idx[k]] = lp[k] + x * (k % 2 ? 0.35 : -0.35);
        idx[k] = (idx[k] + 1) % lens[k];
        if (k % 2) r += o[k] * (k % 4 === 1 ? 1 : -1); else l += o[k] * (k % 4 === 0 ? 1 : -1);
      }
      room[0][i] = l * 0.5; room[1][i] = r * 0.5;
    }
  }

  // ---- sidechain: the kick ducks the bass, chords, pad, lead and room (depth, 3 ms down, ~70 ms back)
  const duck = new Float32Array(n);
  for (const k of kicks) {
    const s0 = Math.round(k * SR);
    for (let i = 0; i < 0.45 * SR; i++) {
      const j = s0 + i; if (j >= n) break;
      const u = i / SR, e = u < 0.003 ? u / 0.003 : Math.exp(-(u - 0.003) / 0.07);
      if (e > duck[j]) duck[j] = e;
    }
  }
  // played instruments pump half as much as the synth
  const DEPTH = Object.fromEntries(Object.entries({ bass: 0.55, chords: 0.3, pad: 0.45, lead: 0.15, room: 0.35 }).map(([k, v]) => [k, song.style === 'synth' ? v : v * 0.5]));

  // the chords and pad keep their body (150–400 Hz) without clouding it: a low cut and a 2.5 dB dip at 330 Hz
  for (const b of [bus.chords, bus.pad]) for (const ch of b) { biquad(ch, 'hp', 140, 0.707); biquad(ch, 'peak', 330, 0.8, -2.5); }
  // the hats' metal rings at 2.7–3.2 kHz (5 dB over its neighbours): cut it
  for (const ch of bus.hats) biquad(ch, 'peak', 2950, 1.2, -8);
  // ---- the mix: bus levels set against the reference songs' stem balance (score-study.md)
  const GAIN = { kick: 0.9, clap: 3.8, hats: 1.05, bass: 0.6, chords: 2.2, pad: 0.5, lead: 0.27, room: 0.8, fx: 1, ...{ synth: {}, organic: STYLE_GAIN.organic, felt: STYLE_GAIN.felt }[song.style] };
  const drums = stereo(), tonal = stereo(), stems = opts.stems ? { drums: stereo(), bass: stereo(), chords: stereo(), lead: stereo(), room: stereo() } : null;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const d = duck[i];
      const dr = bus.kick[c][i] * GAIN.kick + bus.clap[c][i] * GAIN.clap + bus.hats[c][i] * GAIN.hats;
      const ba = bus.bass[c][i] * GAIN.bass * (1 - DEPTH.bass * d);
      const ch = bus.chords[c][i] * GAIN.chords * (1 - DEPTH.chords * d) + bus.pad[c][i] * GAIN.pad * (1 - DEPTH.pad * d);
      const le = bus.lead[c][i] * GAIN.lead * (1 - DEPTH.lead * d);
      const ro = room[c][i] * GAIN.room * (1 - DEPTH.room * d);
      drums[c][i] = dr; tonal[c][i] = ba + ch + le + ro + bus.fx[c][i];
      if (stems) { stems.drums[c][i] = dr; stems.bass[c][i] = ba; stems.chords[c][i] = ch; stems.lead[c][i] = le; stems.room[c][i] = ro; }
    }
  }
  // ---- the close: after the landing everything tonal runs through a low-pass closing 12 kHz → 300 Hz,
  // fading (cos²) from half a second after the landing to 0.3 s before the end
  const stop = D - 0.3;
  if (tail !== null && tail < stop) {
    const f0 = land !== null ? tail + 0.5 : tail;
    const lists = [tonal, ...(stems ? [stems.bass, stems.chords, stems.lead, stems.room] : [])];
    for (const st of lists) for (let c = 0; c < 2; c++) {
      const x = st[c], f1 = new SVF(), f2 = new SVF();
      for (let i = Math.round(tail * SR); i < n; i++) {
        const t = i / SR;
        if (i % 32 === 0 || i === Math.round(tail * SR)) { const fc = 12000 * (300 / 12000) ** Math.min(1, (t - tail) / (stop - tail)); f1.set(fc, 0.707); f2.set(fc, 0.707); }
        const fade = t < f0 ? 1 : t >= stop ? 0 : Math.cos(((t - f0) / (stop - f0)) * Math.PI / 2) ** 2;
        const xf = Math.min(1, (t - tail) / 0.01); // the filters start from silence: fade into them over 10 ms
        x[i] = (f2.run(f1.run(x[i])) * xf + x[i] * (1 - xf)) * fade;
      }
    }
    // with no landing (a score without a kick) the drums close with the rest
    if (land === null) for (let c = 0; c < 2; c++) for (let i = Math.round(tail * SR); i < n; i++) {
      const t = i / SR; drums[c][i] *= t < f0 ? 1 : t >= stop ? 0 : Math.cos(((t - f0) / (stop - f0)) * Math.PI / 2) ** 2;
    }
  }

  // ---- master: a rumble high-pass and a 1.5 dB high-shelf tilt down from 7 kHz (darker than the songs), glue
  // compression (2:1, 8 ms attack, about 1 dB), −14 LUFS, and a clean limiter under −1 dBTP
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = drums[0][i] + tonal[0][i]; R[i] = drums[1][i] + tonal[1][i]; }
  for (const ch of [L, R]) { biquad(ch, 'hp', 28, 0.707); biquad(ch, 'high', 7000, 0.707, -1.5); }
  const glueGr = glue(L, R);
  let lufs = loudness(L, R), peakCut = 0;
  if (Number.isFinite(lufs)) {
    const ceiling = Math.min(CEILING_DBTP - 0.2, LUFS + PLR), tpIn = truePeak(L, R);
    let gainDb = 0;
    for (let pass = 0; pass < 6; pass++) {
      let g = LUFS - lufs;
      g = Math.min(g, ceiling + MAX_CUT - (tpIn + gainDb)); // never ask the limiter for more than MAX_CUT
      if (pass > 0 && g < 0.02) break;
      gainDb += g;
      for (let i = 0; i < n; i++) { L[i] *= 10 ** (g / 20); R[i] *= 10 ** (g / 20); }
      limit(L, R, ceiling);
      lufs = loudness(L, R);
      if (Math.abs(lufs - LUFS) < 0.05) break;
    }
    peakCut = tpIn + gainDb - truePeak(L, R); // how far the limiter brought the loudest peak down
  }
  // 6 ms in, so the first sample never clicks; the close above has already brought the end to silence
  for (let i = 0; i < Math.round(0.006 * SR) && i < n; i++) { const g = i / (0.006 * SR); L[i] *= g; R[i] *= g; }
  for (let i = 0; i < Math.round(0.02 * SR) && i < n; i++) { const g = i / (0.02 * SR); L[n - 1 - i] *= g; R[n - 1 - i] *= g; }

  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;
  mono.left = L; mono.right = R;
  if (stems) mono.stems = stems;
  mono.info = { song: { ...song, motif: undefined }, plan: log, land, tail, lufs: Math.round(lufs * 10) / 10, glueDb: [glueGr.mean, glueGr.max].map((v) => +v.toFixed(1)), peakCutDb: +peakCut.toFixed(1) };
  return mono;
}

// stereo-linked RMS compressor: −threshold set 5 dB over the mix's loud RMS, 2:1, 10 ms / 150 ms
function glue(L, R) {
  const n = L.length, w = Math.round(0.01 * SR);
  let s = 0; const det = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = (L[i] * L[i] + R[i] * R[i]) / 2; s += v;
    if (i >= w) s -= (L[i - w] * L[i - w] + R[i - w] * R[i - w]) / 2;
    det[i] = 10 * Math.log10(Math.max(s / w, 1e-12));
  }
  const sorted = Float32Array.from(det).sort(), ref = sorted[Math.floor(sorted.length * 0.9)];
  const thr = ref - 3, ratio = 2, knee = 6;
  const at = 1 - Math.exp(-1 / (0.008 * SR)), re = 1 - Math.exp(-1 / (0.15 * SR));
  let gr = 0, sum = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const over = det[i] - thr;
    const want = over <= -knee / 2 ? 0 : over >= knee / 2 ? over * (1 - 1 / ratio) : ((over + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / ratio);
    gr += (want - gr) * (want > gr ? at : re);
    const g = 10 ** (-gr / 20); L[i] *= g; R[i] *= g;
    sum += gr; if (gr > max) max = gr;
  }
  return { mean: sum / n, max };
}

export function wav(buf) {
  const ch = buf.left && buf.right ? [buf.left, buf.right] : [buf];
  const n = ch[0].length, k = ch.length, b = Buffer.alloc(44 + n * 2 * k);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * k, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(k, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2 * k, 28); b.writeUInt16LE(2 * k, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2 * k, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767), 44 + (i * k + c) * 2);
  return b;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scoreFile, out] = process.argv.slice(2);
  writeFileSync(out, wav(compose(JSON.parse(readFileSync(scoreFile, 'utf8')))));
  console.log(`wrote ${out}`);
}
