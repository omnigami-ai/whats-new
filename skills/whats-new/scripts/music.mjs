// A small, deterministic music bed for films cut to a beat grid.
//
// A film describes its score (window.template.music):
//   { bpm, duration, root (MIDI note of the key's root, e.g. 45 = A2),
//     chords: [[semitones from root], ...]  one per bar, cycling,
//     sections: [{ from, to (bars), kick, hats, clap, bass, pad (levels 0–1), riser }],
//     breaks: [[from, to] seconds]  drums and bass drop out, the pad holds: the breath before a result }
// and render.mjs --music turns it into audio. Same score, same samples, every time.
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function noise(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

export function compose(score) {
  const { bpm, duration, root = 45, chords = [[0, 3, 7]], sections = [], breaks = [] } = score;
  const beat = 60 / bpm, bar = beat * 4;
  const n = Math.ceil(duration * SR);
  const mix = { drums: new Float32Array(n), bass: new Float32Array(n), pad: new Float32Array(n), fx: new Float32Array(n) };
  const add = (buf, start, len, fn) => {
    const s0 = Math.round(start * SR);
    for (let i = 0; i < len * SR; i++) { const k = s0 + i; if (k >= 0 && k < n) buf[k] += fn(i / SR, i); }
  };
  const at = (b) => sections.find((s) => b >= s.from && b < s.to) || {};
  const kicks = [];

  const bars = Math.ceil(duration / bar);
  for (let b = 0; b < bars; b++) {
    const sec = at(b), t0 = b * bar, chord = chords[b % chords.length];
    for (let q = 0; q < 4; q++) {
      const tb = t0 + q * beat;
      if (sec.kick) {
        kicks.push(tb);
        // a round kick: a pitch-dropping sine (phase accumulated, so the sweep stays clean) with a
        // 1 ms fade-in, and a short decaying 1.8 kHz tick for definition instead of a square click
        let ph = 0;
        add(mix.drums, tb, 0.45, (t) => {
          ph += 2 * Math.PI * (48 + 100 * Math.exp(-t * 35)) / SR;
          const body = Math.sin(ph) * Math.exp(-t * 7.5) * Math.min(1, t / 0.001);
          const tick = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 450) * 0.12;
          return (body + tick) * 0.75 * sec.kick;
        });
      }
      if (sec.clap && (q === 1 || q === 3)) {
        const r = noise(b * 16 + q);
        add(mix.drums, tb, 0.25, (t) => {
          const bursts = Math.exp(-((t % 0.011) * 300)) * (t < 0.033 ? 1 : 0) + Math.exp(-t * 18) * 0.5;
          return r() * bursts * 0.42 * sec.clap;
        });
      }
      if (sec.hats) {
        for (const e of [0, 0.5]) {
          const r = noise(b * 64 + q * 4 + e * 2), open = e === 0.5;
          let prev = 0;
          add(mix.drums, tb + e * beat, open ? 0.18 : 0.06, (t) => {
            const x = r(), hp = x - prev; prev = x; // crude high-pass
            return hp * Math.exp(-t * (open ? 22 : 70)) * (open ? 0.16 : 0.12) * sec.hats;
          });
        }
      }
      if (sec.bass) {
        // off-beat eighth pulses on the chord's root, two octaves down
        const f = hz(root + chord[0] - 12);
        add(mix.bass, tb + beat / 2, beat * 0.48, (t) => {
          const env = Math.min(1, t / 0.006) * Math.exp(-t * 5);
          const ph = 2 * Math.PI * f * t;
          return (Math.sin(ph) * 0.8 + Math.tanh(Math.sin(ph) * 3) * 0.25) * env * 0.5 * sec.bass;
        });
      }
    }
    if (sec.pad) {
      // three detuned voices per chord note, a bar long with soft edges
      const notes = chord.map((c) => root + 12 + c);
      add(mix.pad, t0, bar + 0.4, (t) => {
        const env = Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (bar + 0.4 - t) / 0.4));
        let v = 0;
        for (const m of notes) for (const d of [-0.07, 0, 0.07]) {
          const ph = 2 * Math.PI * hz(m + d) * t;
          v += Math.sin(ph) * 0.6 + Math.sin(2 * ph) * 0.18 + Math.sin(3 * ph) * 0.08;
        }
        return (v / (notes.length * 3)) * env * 0.32 * sec.pad;
      });
    }
    if (sec.riser && (b + 1 >= sec.to)) {
      // a noise swell and rising tone across the section's last bar, into the next downbeat
      const r = noise(900 + b);
      let lp = 0;
      add(mix.fx, t0, bar, (t) => {
        const p = t / bar;
        lp += (r() - lp) * (0.02 + 0.5 * p * p);
        const tone = Math.sin(2 * Math.PI * (200 + 900 * p * p) * t) * 0.08;
        return (lp * 0.5 + tone) * p ** 2;
      });
    }
  }
  // sidechain: bass and pad duck under each kick
  const duck = new Float32Array(n).fill(1);
  for (const k of kicks) {
    const s0 = Math.round(k * SR);
    for (let i = 0; i < 0.3 * SR; i++) { const j = s0 + i; if (j < n) duck[j] = Math.min(duck[j], 1 - 0.65 * Math.exp(-(i / SR) * 11)); }
  }
  // breaks: drums and bass out, with 15 ms edges so nothing clicks
  const edge = 0.015 * SR;
  for (const [a, b] of breaks) {
    const s0 = Math.round(a * SR), s1 = Math.round(b * SR);
    for (let i = Math.max(0, s0 - edge); i < Math.min(n, s1 + edge); i++) {
      const g = i < s0 ? (s0 - i) / edge : i >= s1 ? (i - s1) / edge : 0;
      mix.drums[i] *= g; mix.bass[i] *= g;
    }
  }
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = mix.drums[i] + (mix.bass[i] + mix.pad[i]) * duck[i] + mix.fx[i];
    out[i] = Math.tanh(v * 0.75); // gentle: rounds the rare peak, never squares the kick
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const gain = peak > 0 ? 0.89 / peak : 1; // about -1 dBFS
  for (let i = 0; i < n; i++) out[i] *= gain;
  // a short fade at the very end
  for (let i = 0; i < 0.3 * SR && i < n; i++) out[n - 1 - i] *= i / (0.3 * SR);
  return out;
}

export function wav(buf) {
  const n = buf.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  return b;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scoreFile, out] = process.argv.slice(2);
  writeFileSync(out, wav(compose(JSON.parse(readFileSync(scoreFile, 'utf8')))));
  console.log(`wrote ${out}`);
}
