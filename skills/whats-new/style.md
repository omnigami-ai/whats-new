# What's new: style

A 20–30 second release clip: product identity and category, three changes shown
working on real screens, one sourced count-up, and an update action. Each
feature name ends with a full stop. The grammar repeats with each release.

Style inspired by [@moutaio's
video](https://x.com/moutaio/status/2103826041831588016). An independent style
study; @moutaio did not make or endorse it. Take the grammar, never its product,
features, copy, screens, colours or mark.

## Rev 4 house rules

These supersede the earlier margin and transition measurements below.

- Nothing pops in. Every element starts at zero visibility or behind a
  complete mask, then rises/slides with `kit.motion.out` or `settle`, or
  enters through a mask reveal. A hard cut may change the scene's ground;
  its foreground still enters with motion. UI results follow the region
  rules below.
- At most one radial/circle transition per film; prefer zero. Use cuts on
  the beat, complete-container slides/pushes, edge-aligned mask wipes or
  related match cuts. Converging objects keep their original silhouettes;
  never turn them into dots. Generic `markReveal` identity containers are
  not full-frame radial transitions.
- One **7% side margin / 86% column** for every text block and product
  container: 75.6 px and 928.8 px at 1080 wide. Headlines start at **10%
  of height**, with consistent bottom clearance; Fernwise's proof cards
  finish at 88% of height. Brand lockups fit within that safe column.
- After it fully lands, every text line holds for at least **1.0 s**, and
  at least **0.4 s per three words**. Lengthen the film when necessary;
  do not sacrifice reading time to the beat grid.
- Whooshes/swishes are quiet and occur only with real large motion.
  A small UI result or tiny pointer travel does not need one.

## Rev 5 state changes and living scenes

- **No whole-capture crossfades.** Draw the unchanged native base once.
  Mask each new capture to the element that changed: number, counter,
  progress bar, check, button or reflowing row. Roll numbers inside their
  own tight text viewport, trace a mask over the captured tick, fill a
  pressed control from the contact point, and slide native rows to their
  new positions. Keep gauge labels and arc pixels outside number masks.
  Measure consecutive frames of the result compositor at a fixed camera:
  **zero RGBA differences outside the declared changed boxes**. Review
  cursor/hover, scene travel and motion blur separately.
- **Scenes keep living.** While copy is being read, use meaningful native
  motion: an upcoming control's hover, an easing needle, a rolling value,
  a settling check, a row or confirmation arriving, or cursor travel.
  Once the result lands, a restrained move of the complete container
  (at most 1.5% of frame width) may continue the hold. Keep the UI's scale
  fixed inside its container. Use one focal motion at a time; motions
  belonging to one action may travel together. Never add decoration to
  fill a pause or invent intermediate app states.

Fernwise rev 5 retains all seven native clicks and the 0.60 s complete-scene
pushes. Watering gets 0.60 s more reading time: the proof begins at 17.40 s,
the ending at 21.00 s, and the film ends at 23.60 s. The rescue counter is
the actual **0 → 1 → 2 of 3**; the third check remains unchecked. The
native success banner's **13-day streak** rolls into view after it lands.
It is incidental UI, while **3 plants watered** is the film's proof.

Fernwise's portrait rev 4 uses a sourced **3 plants watered** proof with
photography of the actual three due plants. The source belongs in its
STORY.md. The former account-streak proof and on-film account disclaimer
are removed. See `examples/fernwise/STORY.md` for exact crops and timing.

Revision **4b** overlaps Fernwise's three feature/proof handoffs: each
complete scene pushes horizontally out as the next pushes in over 0.60 s,
centred on 7.2, 12.0 and 16.8 s. Begin incoming foreground entrances 0.50 s
before those beats, including native cards, so both scenes carry visible
content together for at least 0.15 s. Keep the captured UI actions at their
original times and retain each card's internal pixel scale. Never clear
the old beat to an empty ground before the next headline/card arrives.

## Measured grammar

Lamplit portrait **rev 4d** uses the same 0.60 s complete-scene `inOut`
push, centred on 3.30, 9.30 and 15.30 s. Start its incoming headline and
first native card 0.50 s before the beat; stagger later cards by 0.10 s.
Keep UI actions on their existing times. The open's generic mark starts
at 0.00 s, lockup at 0.55 s (fully formed mark alone 0.13 s). At the end,
start the mark at 26.70 s behind the upward dark edge, so its tile is
already legible as it enters; lockup starts at 27.60 s (mark alone 0.48 s).
The amber bar-to-field join, command at 28.90 s, slow final push and
30.60 s end stay in place. These timings supersede the rev 4 bookends below.

The local frame study (`reference/study/release-film/`) measures 43.35 s, 23
shots, 60 fps, 1920 × 1080. Its open is 2.67 s; nine features each take 2.0–4.8
s; the count-up beat is 3.33 s with a 1.1 s count; the end is 2.83 s. Most cuts
fall within three frames of a beat, at approximately 89 BPM. A feature name
above the product uses 9.7–17.5% of the short side; explanatory text uses 4.8%;
a number alone uses 29%.

Lamplit rev 4 is 30.6 s at 60 fps and 100 BPM: open 3.3 s, schedules 6.0 s,
replay 6.0 s, fan-out 7.2 s (including the final 0.6 s rectangular field
expansion), capacity 4.2 s, straight dark push 0.6 s, end 3.3 s. The two
identity lockups finish at 2.10 s and 29.40 s; each has a capped 1.20 s
whole-lockup push. Longer proof and reading holds take precedence over the
old 20–30 s target. Queued, Running and Succeeded each hold at least one
second after their native state masks complete.

## Palette and type

Use the product’s own two grounds. Fernwise, a light-first product, uses cream
and moss. Lamplit stays dark-first throughout its product shots: night
`#080B14`, native app ink `#0E1220`, text `#ECEAE3`, muted `#8D93A8`, with amber
`#FFB23F` as the accent and the stat’s full-bleed field. Never put its dark UI
on an unrelated light ground.

Lamplit uses Instrument Sans and JetBrains Mono, locally loaded with their OFL
files. Tall names are fitted up to 10% of the short side, two balanced lines
(three for long unbroken edits). Supporting lines are up to 4.6%, at most 1/1.6
of the name’s size. Version labels are 3.4%. The count is up to 29%; its source
is 3.3%. Proof UI stays above 28 px on the 1080 px short side. The renderer’s
stress floor also applies to editable words.

## Frame and evidence

Tall titles begin at 10% of height, left aligned at the same 7% edge as the
product cards, with a measured 86%-width title column. The product stack begins
below the measured title and finishes near 88% of frame height. Main proof
windows reach the full width minus 7% on each side; shorter controls and
labels keep their source aspect and capture sharpness. Gaps absorb spare height.
A native crop, background, border and shadow form one complete card. Rounded
corners use 2.6% of the short side, bounded by a quarter of a short card’s
height.

Choose complete captured controls and results, with a small native gutter;
tightly captured pills keep their own complete rounded outline. Do not hide
sliced text behind feathered edges. In Lamplit rev 4 the schedule is three fixed
crops (field, cron boxes, next runs); replay shows the real control and Details,
then the two complete kept-step badges; fan-out shows the resize-images label,
timeline and a persistent selected-row close-up, the complete callout body
without its detached tail, and complete run progress bar. No UI is drawn. Long
panels are omitted when they cannot carry readable, complete text at the
required scale.

**Never scale UI inside a container.** Fix the crop and its pixel scale relative
to its card. Camera pushes grow/move the whole card, including its edge. Camera
travel moves entire cards on `kit.motion.inOut`. When the app’s own layout
shifts, translate the crop to keep the same panel in place, retaining its
dimensions and scale. Never interpolate to a tighter crop inside a stationary
window. Preserve captured aspect ratios.

## House motion

All Lamplit rev 4 easing and identity/cursor motion use `kit.motion`, copied from the engine:

- **Entrances:** `out` or `settle`; cards rise from 8.5% below and 95%
  scale over 0.55 s. Their visible 4.7% camera push uses `inOut` and transforms
  the complete object. Words rise from baseline masks with `out` over
  0.45–0.50 s, staggered 0.04–0.07 s. Nothing enters linearly.
- **Cursors:** `drawCursor`, using one continuous curved path, arrival
  by hit minus 0.08 s, shared hit times with the captured UI, and a
  curved glide off. A real pressed capture is used for the six
  hundredths of a second in which the helper reports pressed. The
  helper’s ripple is clipped to the actual control’s rounded edge on
  a reset CPU-backed helper canvas; the same helper draws the pointer
  without clipping its arrow or shadow. Never shrink a button capture
  over a hand-painted patch.
- **Identity, for any logo:** `markReveal`, a seed becoming a generic
  squircle container, then the supplied mark image, then the wordmark
  and category/promise. Adapt only the mark image and brand fields.
  Never morph the seed into a product-specific silhouette. Combine the
  helper’s 1.8% push with a 2.6% `inOut` camera push of the entire lockup and schedule the cut by `holdEnd`; hold ≤1.2 s.
- **Surfaces:** the real amber progress bar supplies a text-free rectangular
  starting region. Its extension has four square corners, widens along the
  bar, then opens vertically into the stat's amber field over 0.60 s. No
  rounded corner remains where it joins the native bar. The stat exits
  under one straight dark edge moving upward over 0.60 s. Neither uses an
  iris, dot, halo or disconnected shape.
- **Changed captures:** retain fixed native pixel scale per card. Apply
  each new capture only inside its changed element's mask, with the
  element-specific motion above. Typing advances real per-letter captures;
  recognised indicators, cron results and next-run dates have separate masks.
- **Count:** 0 → number in 1.1 s using the house snap; qualifier,
  explanation, payoff and source rise in order. Fit fixed figure slots
  within 80% of width. A subtle house-eased push accompanies the stat.
- **Fit every pill:** measure the complete visible string, including
  `$ ` and spaces, then add padding on both sides. Fit font size to
  available width before measuring. Check maximum edits too.

Hard cuts introduce the feature beats; actions within them move complete cards
or switch to real app states. Keep the camera steady around a hit. No particles,
light leaks, ornamental gradients, unrelated shape wipes, logo-specific morphs,
or letter-splicing transitions.

## Truth, sound and delivery

Use the product’s actual release versions. Each feature’s name and short line
must agree with its visible action and result. The category establishes what the
app is before the first feature. Source every claim in STORY.md; label sample
accounts and capacity limits. Lamplit’s “Up to 10,000” is a sample release’s
stated child-run limit, never measured adoption.

Use the current owned house effects on real actions and a 100 BPM bed, with a
breath before the stat and through the final edge push. Target about −14 LUFS. Keep
the update action on screen to the final frame.

Render, check and stress every shape you deliver. Inspect 12
consecutive frames at every transition, every cursor press and release, logo
phase, edge-wipe phase, state change and camera arrival. Review phone and stress
sheets; re-render the MP4 from that exact source with four-sample motion blur.
Record the evidence and what still needs work in `out/REVIEW.md`.

The detailed Lamplit rev 4 measurements above describe that reference film.
Fernwise's portrait rev 4 retains its cream/moss palette, Keeper mark, light
checks, rescue checklist and real watering flow, with the house rules above
and its new photographic proof. Square and wide are unreviewed this round.

The score's sound is `music.style`: `'synth'`, the default, for Lamplit's reference, and `'organic'` for the Fernwise example. For the user's product, pick by what it is: `'organic'` for plants, food and drink, and other natural or handmade things; `'synth'` (oscillators, the default) for software and tools; `'felt'` (a sparse felt piano over a sub bass and a light kit) for a quiet, minimal film. In a break (`music.breaks`) the drums, bass and lead stop and the chords play on; the film's name seeds the key (always major), the progressions and the patterns.

