// A supplied song (the user's own track, or one of ours), fitted to a film and mixed under its effects.
//
// Fit: the song's tempo, beat grid and bar lines are measured from the sound (the kick for the tempo,
// the attacks for where the beats fall, the song's first strong onset for beat one). It starts on a
// bar line at frame 0 (its first, or the one nearest --from, to use a later section).
// Ending (picked by ear, 2026-10-18): on the last bar line at least 3.5 s before the film's end (in a
// film under ~8 s, 45% of it), one
// landing hit, then the song closes down and fades. With the song's stems (a <song>-stems/ folder
// beside it, or `stems`): the drum and percussion stems play that downbeat and ring out (a beat, then
// a 150 ms decay) and stop; the other stems play on through a low-pass closing 12 kHz → 300 Hz, fading
// from half a second after the downbeat to 0.3 s before the end. The stems are tone-matched to the
// song (1/3-octave gains over the bar before, within ±6 dB): Suno masters a song apart from its stems.
// Without stems the whole song closes and fades the same way. `ending` (s) instead splices, on a bar
// line, into the song's own ending at that time.
// Mix: the song is set to −20.5 LUFS (whatever its master's loudness: 4.5 dB under a −16 LUFS song,
// the balance picked by ear) and never dips as a whole (dips pump against its groove); under each
// audible effect only its 250–1500 Hz, where the kit's effects sit, dips 4 dB.
//
//   const { wav, report } = await fitSong('track.wav', { duration, sfx, bpm, downbeat, from, stems, ending })
//     sfx: the effects stem as a WAV buffer (sfx.mjs's effects()), or null for no carve
//     bpm, downbeat (s): overrides, when the measurement is wrong
//     from (s): start at the bar line nearest this time in the song (as recorded, before any stretch)
//     tempo: the film's BPM; a song within 10% of it is time-stretched to match (atempo, pitch kept)
//     stems: a folder of the song's stems (names with 'drum' or 'perc' are the drums), or false for none
//     ending (s): splice into the song's own ending at this time instead
//     fade (s): close and fade over this long from half a second after the landing, silent after (default: to 0.3 s before the end)
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SR = 48000;
// every cut is 15 ms early (both sides alike, so the rhythm holds): a measured beat can run a little
// late, and a cut must never clip a downbeat's attack
const EARLY = 0.015;
const TAIL = 3.5, LP_FROM = 12000, LP_TO = 300;
const MUSIC_LUFS = -20.5, CARVE_DB = -4, CARVE_LO = 250, CARVE_HI = 1500, KEY_DB = -40;

// integrated loudness (LUFS) of the whole song, as ffmpeg's EBU R128 meter reads it
function loudness(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-']);
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('close', (code) => {
      const m = err.slice(err.lastIndexOf('Summary')).match(/I:\s+(-?[\d.]+) LUFS/);
      if (code || !m) return reject(new Error(`ffmpeg could not measure ${file}`));
      resolve(Number(m[1]));
    });
  });
}

// samples, optionally time-stretched (ffmpeg's atempo: the tempo × r, the pitch kept)
function decode(file, sr, channels, r = 1) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vn', ...(r !== 1 ? ['-af', `atempo=${r}`] : []), '-ac', String(channels), '-ar', String(sr), '-f', 'f32le', '-']);
    const parts = []; let err = '';
    ff.stdout.on('data', (d) => parts.push(d));
    ff.stderr.on('data', (d) => (err += d));
    ff.on('close', (code) => {
      if (code) return reject(new Error(`ffmpeg could not read ${file}: ${err.trim()}`));
      const b = Buffer.concat(parts), x = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
      if (channels === 1) return resolve([x]);
      const n = x.length / channels, out = Array.from({ length: channels }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = x[i * channels + c];
      resolve(out);
    });
  });
}

// onset strength: the rise in log energy, ~2.9 ms a step
function onsets(x, sr) {
  const HOP = 64, WIN = 512, env = [];
  let last = 0;
  for (let p = 0; p + WIN <= x.length; p += HOP) {
    let e = 0; for (let k = p; k < p + WIN; k++) e += x[k] * x[k];
    const l = Math.log(1e-8 + e / WIN);
    env.push(Math.max(0, l - last)); last = l;
  }
  return { env: Float32Array.from(env), rate: sr / HOP, lag: WIN / 2 / sr };
}

// tempo and phase: autocorrelation of the onsets (weighted toward 120 BPM) for the rough tempo, then
// the finest tempo and phase whose grid lands on the most onset strength across the whole song
function grid({ env, rate, lag }) {
  const mean = env.reduce((a, b) => a + b, 0) / env.length, o = env.map((v) => v - mean);
  let rough = null;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const L = (60 / bpm) * rate, l0 = Math.floor(L), fr = L - l0;
    let s = 0; for (let i = 0; i + l0 + 1 < o.length; i++) s += o[i] * (o[i + l0] * (1 - fr) + o[i + l0 + 1] * fr);
    s *= Math.exp(-0.5 * Math.log2(bpm / 120) ** 2 / 0.25);
    if (!rough || s > rough.s) rough = { bpm, s };
  }
  const at = (t) => { const i = t * rate, k = Math.floor(i), f = i - k; return (env[k] || 0) * (1 - f) + (env[k + 1] || 0) * f; };
  let best = null;
  for (let bpm = rough.bpm - 1; bpm <= rough.bpm + 1; bpm += 0.01) {
    const beat = 60 / bpm, n = Math.floor((env.length / rate) / beat);
    for (let ph = 0; ph < beat; ph += 1 / rate) {
      let s = 0; for (let k = 0; k < n; k++) s += at(ph + k * beat);
      if (!best || s > best.s) best = { bpm, ph, s };
    }
  }
  return { bpm: +best.bpm.toFixed(2), phase: best.ph + lag };
}

// where the sound ends: the last 10 ms above −60 dBFS (a download can carry seconds of silence)
function soundEnd(x, sr) {
  const W = Math.round(0.01 * sr);
  for (let p = x.length - W; p >= 0; p -= W) { let e = 0; for (let k = p; k < p + W; k++) e += x[k] * x[k]; if (e / W > 1e-6) return (p + W) / sr; }
  return 0;
}

// zero-phase band: a 2nd-order Butterworth high-pass and low-pass, each run forwards and back
function biquad(x, type, f, sr) {
  const w = (2 * Math.PI * f) / sr, a = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + a;
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const [b0, b1, b2, a1, a2] = [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - a) / a0];
  const run = (v) => { const y = new Float32Array(v.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < v.length; i++) { const o = b0 * v[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v[i]; y2 = y1; y1 = o; y[i] = o; } return y; };
  return run(run(x).reverse()).reverse();
}

// in-place radix-2 FFT (inverse when inv), on Float64Arrays of a power-of-two length
function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const pow2 = (m) => 2 ** Math.ceil(Math.log2(Math.max(2, m)));
const spectrum = (x, a, b, N) => { const re = new Float64Array(N), im = new Float64Array(N); for (let i = a; i < b; i++) re[i - a] = x[i] || 0; fft(re, im); return [re, im]; };

// 1/3-octave gains (from 20 Hz, within ±6 dB) that bring the stems' sum to the song's tone, measured
// over samples a..b; returns gain(f)
function toneMatch(song, stems, a, b) {
  const N = pow2(b - a), mag = (chs) => { const m = new Float64Array(N / 2); for (const x of chs) { const [re, im] = spectrum(x, a, b, N); for (let k = 0; k < N / 2; k++) m[k] += Math.hypot(re[k], im[k]) / chs.length; } return m; };
  const ms = mag(song), mt = mag(stems), bands = [];
  for (let k = 0; k < 30; k++) {
    const c = 20 * 2 ** (k / 3), lo = c / 2 ** (1 / 6), hi = c * 2 ** (1 / 6);
    let es = 0, et = 0; for (let i = Math.ceil((lo * N) / SR); i < Math.min(N / 2, (hi * N) / SR); i++) { es += ms[i] ** 2; et += mt[i] ** 2; }
    bands.push({ lo, hi, g: Math.min(2, Math.max(0.5, Math.sqrt(es / (et + 1e-12)))) });
  }
  return (f) => (bands.find((x) => f >= x.lo && f < x.hi) || { g: 1 }).g;
}

// a real-valued gain curve applied to x[a..] (zero phase)
function applyCurve(x, a, gain) {
  const m = x.length - a, N = pow2(m), [re, im] = spectrum(x, a, x.length, N);
  for (let k = 0; k <= N / 2; k++) { const g = gain((k * SR) / N); re[k] *= g; im[k] *= g; if (k && k < N / 2) { re[N - k] *= g; im[N - k] *= g; } }
  fft(re, im, true);
  for (let i = 0; i < m; i++) x[a + i] = re[i];
}

// the song's stems, summed into drums (names with 'drum' or 'perc') and the rest, each [L, R]
async function loadStems(dir, r) {
  const files = readdirSync(dir).filter((f) => /\.(wav|flac|aiff?|mp3|m4a)$/i.test(f)).sort();
  const sum = async (list) => { let out = null; for (const f of list) { const [cl, cr] = await decode(path.join(dir, f), SR, 2, r); if (!out) out = [new Float32Array(cl.length), new Float32Array(cl.length)]; for (let i = 0; i < Math.min(cl.length, out[0].length); i++) { out[0][i] += cl[i]; out[1][i] += cr[i]; } } return out; };
  const drums = files.filter((f) => /drum|perc/i.test(f)), rest = files.filter((f) => !/drum|perc/i.test(f));
  if (!drums.length || !rest.length) throw new Error(`${dir}: needs a drum (or percussion) stem and at least one other`);
  return { drums: await sum(drums), rest: await sum(rest), count: files.length };
}

function sfxKey(buf, n) {
  const key = new Float32Array(n);
  if (!buf) return key;
  const m = Math.min(n, (buf.length - 44) / 4), th = 10 ** (KEY_DB / 20) * 32767;
  const at = Math.exp(-1 / (0.005 * SR)), rl = Math.exp(-1 / (0.12 * SR));
  let k = 0;
  for (let i = 0; i < n; i++) {
    const on = i < m && Math.abs(buf.readInt16LE(44 + i * 4) + buf.readInt16LE(46 + i * 4)) / 2 > th ? 1 : 0;
    const c = on > k ? at : rl; k = c * k + (1 - c) * on; key[i] = k;
  }
  return key;
}

export async function fitSong(file, { duration, sfx = null, bpm, downbeat, from = 0, stems, ending, tempo, land, fade } = {}) {
  // the beat from the kick and bass (under 150 Hz): in a straight-eighths groove the hats sound as
  // often as the kick, and a grid from every onset can lock onto the off-beats
  const [m22] = await decode(file, 22050, 1), low = biquad(m22, 'lp', 150, 22050);
  const g = bpm && downbeat !== undefined ? { bpm, phase: downbeat } : grid(onsets(low, 22050));
  if (bpm) g.bpm = bpm;
  // the low band's beat is late (a kick's low end builds over tens of ms): move it to the full-band
  // attack, within 60 ms
  const full = onsets(m22, 22050), fat = (t) => full.env[Math.round((t - full.lag) * full.rate)] || 0;
  if (downbeat === undefined) {
    const beat = 60 / g.bpm, n = Math.floor(m22.length / 22050 / beat);
    let best = 0, top = -1;
    for (let d = -0.06; d <= 0.06; d += 1 / full.rate) { let s = 0; for (let k = 0; k < n; k++) s += fat(g.phase + d + k * beat); if (s > top) { top = s; best = d; } }
    g.phase += best;
  }
  let bar = (4 * 60) / g.bpm;
  // the bar lines (if not given): beat one is the beat nearest the song's first strong onset (at least
  // half as strong as the strongest in its first 2 s); an opening pickup a little early is left out
  let first = downbeat;
  if (first === undefined) {
    const beat = 60 / g.bpm, head = full.env.subarray(0, Math.round(2 * full.rate)), top = Math.max(...head);
    const lead = head.findIndex((v) => v >= top / 2) / full.rate + full.lag;
    first = g.phase + Math.round((lead - g.phase) / beat) * beat;
    if (first < 0) first += beat * Math.ceil(-first / beat);
  }
  const start0 = first + Math.max(0, Math.round((from - first) / bar)) * bar;
  // to the film's tempo, when it's within 10% (stems alike): times in the song scale by 1/r
  const r = tempo && Math.abs(tempo / g.bpm - 1) > 0.001 && Math.abs(tempo / g.bpm - 1) <= 0.1 ? tempo / g.bpm : 1;
  const [L, R] = await decode(file, SR, 2, r);
  const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  bar /= r; first /= r; const start = start0 / r;
  const end = soundEnd(mono, SR), beat = bar / 4;
  const n = Math.ceil(duration * SR), s0 = Math.round(Math.max(0, start - EARLY) * SR), xf = Math.round(0.01 * SR);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (const [c, src] of [[0, L], [1, R]]) for (let i = 0; i < n; i++) out[c][i] = src[s0 + i] || 0;
  let report;
  if (ending !== undefined) {
    // the song's own ending, from the bar line at or just before the given time, ringing out in the film
    const hit = first + Math.floor((Number(ending) / r + 0.03 - first) / bar) * bar, ring = end - hit;
    const bars = Math.floor(Math.min(hit - start, duration - ring) / bar + 1e-6);
    if (bars < 1) throw new Error(`the song has no whole bar to use from ${start.toFixed(2)} s before its ending (bar ${bar.toFixed(3)} s, ending ${ring.toFixed(2)} s, film ${duration} s)`);
    const body = Math.round(bars * bar * SR), h0 = Math.round(Math.max(0, hit - EARLY) * SR), e = Math.round(end * SR);
    for (const [c, src] of [[0, L], [1, R]]) for (let i = body - xf; i < n; i++) {
      const tail = h0 + i - body < e ? src[h0 + i - body] || 0 : 0;
      out[c][i] = i < body ? out[c][i] * ((body - i) / xf) + tail * (1 - (body - i) / xf) : tail;
    }
    report = { ending: 'song', at: +(bars * bar).toFixed(3), from: +hit.toFixed(3), ring: +ring.toFixed(2) };
  } else {
    if (start + duration > end) throw new Error(`the song ends ${(start + duration - end).toFixed(1)} s too soon for this film from ${start.toFixed(2)} s: use an earlier --from`);
    // a short film gets a shorter tail: at most 45% of it
    // or on the film's own landing (`land`, film seconds), at the bar line nearest it
    const T = land !== undefined ? Math.round(land / bar) * bar : Math.floor((duration - Math.min(TAIL, duration * 0.45)) / bar + 1e-6) * bar, Ti = Math.round(T * SR), stop = fade ? Math.min(duration - 0.3, T + 0.5 + fade) : duration - 0.3;
    if (T < bar) throw new Error(`the film (${duration} s) is too short for an ending after a whole bar (${bar.toFixed(2)} s)`);
    const dir = stems === undefined ? file.replace(/\.[^./]+$/, '') + '-stems' : stems;
    const st = dir && existsSync(dir) ? await loadStems(dir, r) : null;
    // the tail, from the crossfade before the downbeat: the other stems (or the song) through the closing
    // low-pass (20 ms blocks, the filter's state carried) and the eased (cos²) fade from half a second
    // after the downbeat, plus the drum stems' landing hit
    const a = Ti - xf, f0 = T + 0.5, blk = Math.round(0.02 * SR), tail = [new Float32Array(n - a), new Float32Array(n - a)];
    for (let c = 0; c < 2; c++) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, cf = null;
      for (let i = a; i < n; i++) {
        let v = st ? st.rest[c][s0 + i] || 0 : out[c][i];
        if (i >= Ti) {
          if ((i - Ti) % blk === 0) {
            const f = LP_FROM * (LP_TO / LP_FROM) ** Math.min(1, (i / SR - T) / (stop - T));
            const w = (2 * Math.PI * f) / SR, al = Math.sin(w) / (2 * Math.SQRT1_2), cs = Math.cos(w), a0 = 1 + al;
            cf = [(1 - cs) / 2 / a0, (1 - cs) / a0, (1 - cs) / 2 / a0, (-2 * cs) / a0, (1 - al) / a0];
          }
          const o = cf[0] * v + cf[1] * x1 + cf[2] * x2 - cf[3] * y1 - cf[4] * y2;
          x2 = x1; x1 = v; y2 = y1; y1 = o; v = o;
        }
        const t = i / SR, fade = t < f0 ? 1 : t >= stop ? 0 : Math.cos(((t - f0) / (stop - f0)) * Math.PI / 2) ** 2;
        const hit = !st || i < Ti ? 0 : i < Ti + beat * SR ? 1 : Math.exp(-((i - Ti - beat * SR) / SR) / 0.15);
        tail[c][i - a] = v * fade + (hit ? (st.drums[c][s0 + i] || 0) * hit : 0);
      }
    }
    if (st) {
      const all = [0, 1].map((c) => { const x = new Float32Array(L.length); for (let i = 0; i < x.length; i++) x[i] = (st.rest[c][i] || 0) + (st.drums[c][i] || 0); return x; });
      const gain = toneMatch([L, R], all, s0 + Ti - Math.round(bar * SR), s0 + Ti);
      for (const ch of tail) { const x = Float64Array.from(ch); applyCurve(x, 0, gain); ch.set(x); }
    }
    // 10 ms crossfade into the tail, ending on the downbeat
    for (let c = 0; c < 2; c++) for (let i = a; i < n; i++) { const r = Math.min(1, (i - a) / xf); out[c][i] = out[c][i] * (1 - r) + tail[c][i - a] * r; }
    report = { ending: st ? `stems (${st.count})` : 'closes (no stems)', at: +T.toFixed(3) };
  }
  for (const ch of out) for (let i = 0; i < Math.round(0.006 * SR); i++) ch[i] *= i / (0.006 * SR);
  // the mix: steady level, and a carve in 250–1500 Hz under each audible effect
  const lufs = await loudness(file);
  const key = sfxKey(sfx, n), gain = 10 ** ((MUSIC_LUFS - lufs) / 20), dip = 10 ** (CARVE_DB / 20) - 1;
  for (const ch of out) {
    const mid = biquad(biquad(ch, 'hp', CARVE_LO, SR), 'lp', CARVE_HI, SR);
    for (let i = 0; i < n; i++) ch[i] = (ch[i] + mid[i] * dip * key[i]) * gain;
  }
  return { wav: wav(out), report: { lufs, bpm: g.bpm, ...(r !== 1 ? { stretchedTo: tempo } : {}), start: +start0.toFixed(3), ...report } };
}

function wav([left, right]) {
  const n = left.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const s16 = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  for (let i = 0; i < n; i++) { b.writeInt16LE(s16(left[i]), 44 + i * 4); b.writeInt16LE(s16(right[i]), 46 + i * 4); }
  return b;
}
