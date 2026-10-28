// Sound effects on a film's cues, mixed from omnigami's own kit in sounds/
// (designed in code by tools/sound/design.py, ours to ship anywhere). A pure
// function of the cue list, so the same film always gets the same audio.
//
//   node scripts/sfx.mjs cues.json out/sfx.wav [duration-seconds]
//   cues.json: [{ "t": 0.12, "type": "tap" }, { "t": 6, "type": "hit", "gain": 0.6 }, ...]
//
// Types are the sounds in sounds/kit.json, which says what each is for: tap,
// click, tick, toggle, pop, swish, whoosh, sparkle, chime, ping, riser, hit, and the playful,
// pitched pluck (four notes in turn), blip and zip (a rising glide that crests on its cue).
// Each lands its moment on the cue: a whoosh or a riser crests there.
// Sounds with variants (tick) take them in turn. 'thump' still means a softer hit.
// Motion cues may set duration (total sound length, 0.5–2× the source) to match
// a faster/slower move, or lead (seconds before the cue) for an explicit offset.
// Swish/whoosh require motion: { kind: 'camera' | 'container', travel: 0.4 }.
// Travel is the largest screen-space displacement of the moving container's
// centre/edge or the camera's visible content: max(abs(dx)/width, abs(dy)/height),
// measured across the whole move in the output frame (including zoom). Only
// travel > 0.25 qualifies. UI changes and unmeasured legacy sweeps stay silent;
// gain/duration are never evidence of a large move. Risers are unchanged.
// Duplicate contacts merge; near-coincident accents share headroom. Separate
// actions and typing remain separate. The renderer sets final film loudness.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const DIR = new URL('./sounds/', import.meta.url);
export const KIT = JSON.parse(readFileSync(new URL('kit.json', DIR), 'utf8'));
const ALIASES = { thump: { type: 'hit', gain: 0.6 } };

// A 16- or 24-bit PCM WAV at 48 kHz, as [left, right].
function readWav(url) {
  const b = readFileSync(url);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${url.pathname}: not a WAV file`);
  let fmt, data;
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.rate !== SR || ![16, 24].includes(fmt.bits)) throw new Error(`${url.pathname}: expected 16- or 24-bit PCM at ${SR} Hz`);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  const out = [new Float32Array(frames), new Float32Array(frames)];
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const o = (i * fmt.channels + Math.min(c, fmt.channels - 1)) * bytes;
      out[c][i] = bytes === 2 ? data.readInt16LE(o) / 32768 : data.readIntLE(o, 3) / 8388608;
    }
  }
  return out;
}
const loaded = new Map();
const load = (file) => loaded.get(file) || loaded.set(file, readWav(new URL(file, DIR))).get(file);

const MOTION = new Set(['swish', 'whoosh', 'riser']);
const SWEEP = new Set(['swish', 'whoosh']);
const CONTACT = new Set(['tap', 'click', 'toggle', 'tick']);
const GROUP = (type) => MOTION.has(type) ? 'motion' : CONTACT.has(type) ? 'contact' : 'accent';
const GAP = { tick: 0.012, tap: 0.025, click: 0.025, toggle: 0.06, pop: 0.06, hit: 0.08, chime: 0.12, ping: 0.10, sparkle: 0.10, swish: 0.06, whoosh: 0.06, riser: 0.12, pluck: 0.03, blip: 0.06, zip: 0.08 };

// Export the placement plan so timing and density can be inspected without
// guessing from the mixed waveform. Sort a copy; never change a film's cues.
export function placeCues(cues) {
  const placed = [];
  for (const cue of cues) {
    const alias = ALIASES[cue.type];
    const type = alias?.type ?? cue.type;
    const sound = KIT[type];
    if (!sound) throw new Error(`unknown sound '${cue.type}' at ${cue.t} s; the kit has ${Object.keys(KIT).join(', ')}`);
    if (!Number.isFinite(cue.t) || !Number.isFinite(cue.gain ?? 1) || (cue.gain ?? 1) < 0) throw new Error(`invalid sound cue: ${JSON.stringify(cue)}`);
    if (cue.duration !== undefined && (!Number.isFinite(cue.duration) || cue.duration <= 0)) throw new Error(`invalid cue duration at ${cue.t} s`);
    if (cue.lead !== undefined && (!Number.isFinite(cue.lead) || cue.lead < 0)) throw new Error(`invalid cue lead at ${cue.t} s`);
    if (SWEEP.has(type)) {
      const motion = cue.motion;
      if (motion !== undefined && (!motion || typeof motion.kind !== 'string' || !Number.isFinite(motion.travel) || motion.travel < 0)) throw new Error(`invalid cue motion at ${cue.t} s`);
      if (!motion || !['camera', 'container'].includes(motion.kind) || motion.travel <= .25) continue;
    }
    placed.push({ ...cue, type, gain: (cue.gain ?? 1) * (alias?.gain ?? 1), order: placed.length });
  }
  placed.sort((a, b) => a.t - b.t || a.order - b.order);
  const unique = [];
  for (const cue of placed) {
    if (!cue.gain) continue;
    const duplicate = unique.findLast((p) => p.type === cue.type && cue.t - p.t <= GAP[cue.type]);
    if (duplicate) {
      // Keep the more intentional cue's time as well as its gain.
      if (cue.gain > duplicate.gain) Object.assign(duplicate, cue);
    } else unique.push(cue);
  }
  unique.sort((a, b) => a.t - b.t || a.order - b.order);
  const taken = {};
  return unique.map((cue) => {
    const sound = KIT[cue.type];
    taken[cue.type] = (taken[cue.type] ?? -1) + 1;
    const file = sound.files[taken[cue.type] % sound.files.length];
    const seconds = load(file)[0].length / SR;
    let stretch = MOTION.has(cue.type) && cue.duration !== undefined ? Math.max(0.5, Math.min(2, cue.duration / seconds)) : 1;
    // Fast successive moves need shorter air, not several long sweeps on top
    // of each other. A supplied duration is an intentional override.
    if (MOTION.has(cue.type) && cue.duration === undefined) {
      const neighbour = unique.filter((p) => p !== cue && MOTION.has(p.type)).reduce((gap, p) => Math.min(gap, Math.abs(p.t - cue.t)), Infinity);
      stretch = Math.max(0.5, Math.min(1, neighbour / (seconds * .8)));
    }
    // Share energy only within a voice family; a click under a transition
    // remains distinct. No track-wide gain drop because one cue is crowded.
    const window = CONTACT.has(cue.type) ? .025 : .1;
    const others = unique.filter((p) => p !== cue && GROUP(p.type) === GROUP(cue.type) && Math.abs(p.t - cue.t) < window);
    const energy = cue.gain ** 2 + others.reduce((sum, p) => sum + p.gain ** 2, 0);
    const loudest = Math.max(cue.gain, ...others.map((p) => p.gain));
    const gain = cue.gain * loudest / Math.sqrt(energy);
    const lead = cue.lead ?? sound.lead * stretch;
    return { t: cue.t, type: cue.type, file, gain, lead, stretch, start: cue.t - lead, duration: seconds * stretch, ...(SWEEP.has(cue.type) ? { motion: { ...cue.motion } } : {}) };
  });
}

export function effects(cues, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('sound duration must be positive');
  const n = Math.ceil(duration * SR);
  const mix = [new Float32Array(n), new Float32Array(n)];
  for (const cue of placeCues(cues)) {
    const channels = load(cue.file);
    const start = Math.round(cue.start * SR), length = Math.round(channels[0].length * cue.stretch);
    for (let j = Math.max(0, -start); j < length && start + j < n; j++) {
      const position = j / cue.stretch, k = Math.floor(position), fraction = position - k;
      for (let c = 0; c < 2; c++) {
        const a = channels[c][k] ?? 0, b = channels[c][k + 1] ?? 0;
        mix[c][start + j] += (a + (b - a) * fraction) * cue.gain;
      }
    }
  }
  // A pre-rolled sweep may already be loud at frame zero; a last cue may
  // still be ringing at the cut. Round both stem boundaries to avoid clicks.
  const fadeIn = Math.min(n, Math.round(.002 * SR)), fadeOut = Math.min(n, Math.round(.01 * SR));
  for (const ch of mix) {
    for (let i = 0; i < fadeIn; i++) ch[i] *= Math.sin(i / Math.max(1, fadeIn - 1) * Math.PI / 2) ** 2;
    for (let i = 0; i < fadeOut; i++) ch[n - 1 - i] *= Math.sin(i / Math.max(1, fadeOut - 1) * Math.PI / 2) ** 2;
  }
  // overlaps never clip: if the mix would, the whole track comes down together
  let peak = 0;
  for (const ch of mix) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return wav(mix, peak > 0.95 ? 0.95 / peak : 1);
}

function wav([left, right], scale) {
  const n = left.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const s16 = (x) => Math.round(Math.max(-1, Math.min(1, x * scale)) * 32767);
  for (let i = 0; i < n; i++) { b.writeInt16LE(s16(left[i]), 44 + i * 4); b.writeInt16LE(s16(right[i]), 46 + i * 4); }
  return b;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cuesFile, out, dur] = process.argv.slice(2);
  const cues = JSON.parse(readFileSync(cuesFile, 'utf8'));
  writeFileSync(out, effects(cues, Number(dur) || Math.max(...cues.map((c) => c.t)) + 3));
  console.log(`wrote ${out}`);
}
