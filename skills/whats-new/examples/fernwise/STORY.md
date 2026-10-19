# Fernwise: what's new — rev 6

A **20 s, 1080 × 1920, 60 fps, 120 BPM** plant-care update, revised in
portrait only. Fernwise is a fictional company made for omnigami's examples.
This sample update groups existing working features. It invents no release
number, date, price, rescue success or claim that they shipped together.
Wide and square exports remain from earlier revisions.

The viewer finds a kinder spot for Dot, makes two rescue checks and sets a
reminder, then waters the three plants due today. The proof is the result
just demonstrated: **3 plants watered. Every thirsty plant, taken care of.**
The ask is **Update Fernwise**.

| Time | Words | Real product evidence |
| --- | --- | --- |
| 0–2.5 s | Fernwise · Plant care. What's new. | Cream container → original Keeper glyph → wordmark and purpose, with `kit.motion.markReveal`. |
| 2.5–5.5 s | Light check. · Find Dot a kinder spot. | At 3.0 s the cursor presses Check the plant stand. The native knob follows the app's logarithmic arc from 12,000 to 1,800 lux; recorded readings and verdict roll in their own line boxes. The needle finishes at 4.11 s, leaving 1.14 s before the push. Bright and Direct change as complete words. |
| 5.5–8.5 s | Rescue guides. · Three small steps. A reminder for later. | Checks at 5.75 and 6.25 s: green expands radially from each circle's centre over 0.20 s on `motion.out`; the captured check draws its short stem and long arm over 0.25 s on `motion.settle`. Only that checkbox and the 0 → 1 → 2 of 3 counter change. Text colour, card and photograph stay still; checkbox hover fills and pointer ripples are suppressed. At 6.875 s the reminder changes; its confirmation finishes at 7.235 s and holds 1.015 s before the push. The week-long third step stays unchecked. |
| 8.5–15.0 s | Watered today. · One tap per plant. Everyone gets a drink. | Presses at 9.0, 10.5 and 12.0 s water Monty, Pickles and Fernando. After the 0.06 s press, each native ring sweeps to full for exactly 1 s, with the app's terracotta → green transition. Then the due row collapses, lower rows slide up, the completed native row enters Watered today, and each count rolls separately. All watered and its native 13-day streak finish by 13.71 s, leaving 1.04 s before the push. |
| 15.0–17.5 s | Today. · 3 · plants watered. · Every thirsty plant, taken care of. | The proof number rolls 0 → 3; photographs of exactly the watered plants enter with a 0.22 s stagger and continue a small group drift. The final payoff line holds 1.225 s before the push. |
| 17.5–20.0 s | Fernwise · Keep the little ones alive. · Update Fernwise | One moss container and the original transparent cream Keeper glyph. Wordmark starts at 18.30 s; the promise and ask finish by 18.80 s, followed by the helper's 1.20 s slow push. The fully visible glyph is alone for 0.43 s before the wordmark. |

Five one-beat, **0.50 s horizontal pushes of the complete scenes** use
`kit.motion.inOut`: 2.25–2.75, 5.25–5.75, 8.25–8.75, 14.75–15.25 and
17.25–17.75 s. Foreground entrances start one beat before each boundary.
No circular scene handoffs. The native app controls and their result
animations determine the feature lengths; the opening, proof and ending
keep the required reading holds.

## Product truth and sources

`cast/fernwise/app/data.js` defines today's due plants as exactly
`['monty', 'pickles', 'fernando']`. Olive, Spike, Basil and Dot are not
watered. The real Water actions move the three plants into the completed
list; the recorded final capture says **Watered today · 3** and **All watered.**
The proof number means these three actions, never adoption, plants rescued
or elapsed time. The 13-day streak is incidental native UI.

| Claim | Source |
| --- | --- |
| Fernwise; Plant care; Keep the little ones alive. | `cast/fernwise/brand.md`. |
| 12,000 lux too much; 1,800 lux good for Dot | `data.js` light.spots, Dot's needs and real Light captures. |
| Find Dot a kinder spot | Editorial summary of the two native verdicts, not measured recovery. |
| Three small steps; reminder | `data.js` rescue.dot.checklist and working reminder. Only two checks are completed. |
| One tap per plant; everyone gets a drink | The three Water actions; everyone means today's thirsty plants. |
| Empty terracotta ring → full green ring | `app.js` `level`, `ringColor`, `portrait`; `app.css` `.ring-fill`. |
| Update Fernwise | Editorial call to action for this fictional example. |

## Captured assets and compositing

Existing `assets/full/` and `assets/screens/` footage comes from the approved
working app. The real gauge has one band silhouette, 2.5° internal gaps,
outer round caps and stable verdict height. The film moves the captured
knob along its native logarithmic arc and rolls endpoint strings; it never
invents intermediate UI numbers. The verdict viewport cannot enter the lux
number viewport. All photography and fonts are approved local cast assets.

Rev 6 adds `plans/rev6-rings.json` → `assets/rings/`: **61 native SVG
samples at 60 fps**. The plan uses the app's existing ring element, native
empty/full dash offsets and endpoint colours, and its exact
`cubic-bezier(.4,0,.2,1)` transitions: 1 s for dash offset, 0.6 s for colour.
Web Animations pauses those native properties at explicit times because the
capture tool otherwise disables CSS transitions. No app source is changed.
Only the annulus is composited; Monty's capture supplies identical ring
artwork for all three plants, never any photograph pixels. Each plant's
original photograph remains pixel-identical while its ring fills.

Due rows remain opaque immutable tiles from `today`, and completed rows
remain tiles from `watered-3`. Only the captured ring annulus changes during
the first second. Layout starts at press + 1.06 s and settles over 0.43 s.
Counters, section labels, narrow panel edges and the final banner have
separate masks. No whole-list or whole-capture state dissolve.

The reminder is composited once into a reset CPU-backed tile. Two blank
native button backings interpolate before the two captured labels roll.
Its full silhouette, including native edge pixels and a four-pixel gutter,
is drawn once; no overlapping rounded clip re-antialiases the border.

The closing fringe was local to the film: dark `#28452A` behind a 96%-size
opaque moss SVG. The container now uses the correct `#3E6B3A`; the inverse
SVG's background path is removed in `mark-cream-glyph.svg`, preserving its
original glyph path. `markReveal` paints the container once and clips the
transparent glyph. Opening already uses the transparent moss glyph on one
cream container. Engine and cast source are unchanged by rev 6.

## Timing, music and verification

Side margins remain **75.6 px / 7%**, the column **928.8 px / 86%**, title
top **192 px / 10%**, and product bottom **1689.6 px / 88%**. During actions
the camera is fixed. After results, whole-container drift and unused-ground
trimming preserve the capture's pixel scale. Every helper canvas is
CPU-backed and reset before drawing; `seek(t)` resets the main context.

Music is rebuilt at **120 BPM, root D3 / MIDI 50**, with upward I–V–vi–IV
voicings `[[0,4,7],[7,11,14],[9,12,16],[5,9,12]]`, more hats and claps, a
lift into proof and short half-beat breaths. Sound is regenerated with the
current engine impact and owned effects via `--music --sound`.

Delivery: `out/rev6/9x16.mp4`; playable review and all twelve-frame strips
in `out/rev6/index.html` and `TRANSITIONS.md`. `detail-audit.json` records
reading times, strict tick isolation, border monotonicity and all 155
maximum-edit transition samples with the scene translation removed.
Stress samples cover settled layouts and complete handoff endpoints;
intentional sliding frame-edge crossings are checked in the dense strips
and maximum-edit audit. `region-audit.json` measures exact consecutive
frames, with only individual element boxes declared. `REPORT.md` records
final results and limitations.

Style inspired by [@moutaio's video](https://x.com/moutaio/status/2103826041831588016).
An independent style study; @moutaio did not make or endorse this film.
