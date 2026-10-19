# Lamplit: what's new

A **30.6 s**, 60 fps release clip for Lamplit, a fictional background-jobs
product for developers made for omnigami’s examples, in a night-and-amber
palette. The tall cut (9:16) is the finished one; the square and wide layouts
are in the file but haven't had the same review.
The score stays at 100 BPM.

The viewer learns what changed across v3.2–v3.4, sees each feature working,
reads a sourced capacity limit, and gets the update command.

Every product pixel is captured from the working `cast/lamplit/app/`,
sample account `pebble-shop`. Fixed crops show complete controls or results.
Their capture scale is constant relative to their card; camera pushes and
travel transform the complete card, including its background and border.
No capture zooms inside a stationary window. Long log panels and partial
banner sentences from rev 2 are removed in favour of the complete Details
status and complete kept-step badges.

Assets: `plans/narrow.json` → `assets/screens-narrow/` (typing),
`plans/details.json` → `assets/details/` (replay states),
`plans/desktop.json` → `assets/screens/` (timeline and callout),
`plans/fanout-proof.json` → `assets/proof/` (complete fan-out bar).
`plans/replay-press.json` → `assets/pressed/` records a real mouse-down
capture before mouse-up triggers replay. Lamplit’s app has a hover colour
and no separate CSS `:active` geometry; the held pointer capture is that
actual state, without a drawn shrink, patch or added button surface.
`plans/fanout-press.json` captures the bar and open-run control while held,
including their native hover/pressed colours on exactly the helper’s press
frames. `plans/controls.json` records replay idle/held at 5×, both complete kept
badges at 5×, and the resize-images label at 6×. These native higher
resolution crops can fill the frame without inventing or stretching UI.
Fonts and the unchanged mark image are local. `kit.js` is copied byte for
byte from `engine/kit.js`.

| Time | Beat | Words and evidence | Motion |
| --- | --- | --- | --- |
| 0–3.30 | Open | lamplit · “Background jobs for developers.” · “What’s new, 3.2 to 3.4” | Generic `markReveal`: seed at 0.12, supplied SVG in its squircle, lockup at 1.60. Release words rise at 1.50; category fully lands at 2.10. Whole-lockup push lasts 1.20 s to the cut. Release line is fully readable for 1.14 s. |
| 3.30–9.30 | v3.4 | “Schedules in plain English.” · “Type when a job runs. Lamplit writes the cron.” | All title entrances begin after the cut. Fixed-crop field, cron and next-run cards enter at 3.90, 4.00 and 4.10. Cursor presses at 4.40; native text types from 4.80 and 6.20. Recognised indicator, cron and next-run results wipe in over 0.35 s. Final result finishes revealing at 7.06 and holds 2.24 s. |
| 9.30–15.30 | v3.3 | “Replay from any step.” · “A failed run picks up at the step that failed.” | Button and Details enter after the title, at 9.90 and 10.00. Cursor presses at 10.80, sharing the real held capture. Details changes through 0.30 s native capture masks: Queued 10.92, Running 12.50, Succeeded 13.80. Their completed states hold 1.28, 1.00 and 1.20 s. From 12.00–12.75, the button travels left and two complete kept-step badges enter right while the whole Details card moves. |
| 15.30–21.90 | v3.2 | “Fan-out.” · “412 images, one step, one row.” | Title, job label, selected row and timeline all enter with motion. Cursor presses the row at 17.10; at 17.22 the timeline slides left and the captured callout enters right, landing by 17.97. One continuous cursor path presses “Open run #52,318” at 19.20. From 19.32–19.92 the complete row and callout move up, the job label exits left, and the native “fan-out · 340 of 412” progress bar enters below. Final proof is fully landed by 19.97 and holds until 21.90. |
| 21.90–22.50 | Amber bar → field | The actual progress bar grows into the next field | One rectangle starts in the unlettered amber at the right end of the real bar. Its four corners are square. It first widens along the bar, then opens vertically with house easing to full-bleed amber. The shape joins the bar without rounded meeting corners. No iris, circular seed, halo or detached object. |
| 22.50–26.70 | Capacity | “Up to 10,000” · “child runs from one step.” · “All of them on one row.” · “Sample releases · v3.2” | Count-up takes 1.10 s. Every line rises and fades after the field lands. Source fully lands at 25.04 and holds 1.66 s; explanation and payoff hold longer. Source labels the fictional release capacity, not adoption. |
| 26.70–27.30 | Straight dark push | Amber gives way to the end | One horizontal dark edge moves upward on `inOut` over 0.60 s, fully covering the stat before the end identity begins. Zero circular wipes in the film. |
| 27.30–30.60 | Update | lamplit · “Every job, in the light.” · `$ npm i lamplit@latest` | Same generic `markReveal`: seed at 27.42, lockup and measured command pill at 28.90, promise at 29.05. Identity finishes at 29.40, then the capped 1.20 s whole-lockup push reaches the final frame. Command finishes entering at 29.33 and holds 1.27 s. Its total prompt, text and padding fit inside the 7% side margins at maximum push. |

Titles and captured containers share the **75.6 px side margin** (7% of
1080); the common column is 928.8 px wide. Title tops are 192 px (10% of
1920), and evidence finishes at 1689.6 px (88%). Centred elements fit
inside that same safe column. Source lines stay within the bottom safe
area, including their push. Complete cards keep their fixed capture
scale and aspect ratio relative to their own frame; no internal UI zoom.

All cursor presses use `kit.motion.drawCursor`. Its ripple is rendered on a
CPU-backed helper and clipped to the actual clicked control’s rounded edge;
the pointer is drawn separately by the same helper, preserving its press
scale and shadow. Every helper resets before each use. All foreground
entrances use motion plus fade or an edge mask. Every final line holds at
least `max(1.0 s, words × 0.4 / 3)` after landing; the longer 30.6 s duration
is deliberate. Quiet air effects occur only on large card travel and the
two field transitions. Local preview playback alone owns a clock;
`seek(t)` does not.

## Claims

Every word and number on screen, with its source in the sample data
(`cast/lamplit/app/data.js` and the screens it draws).

| Claim | Source |
|---|---|
| Schedules in plain English (v3.4) | Releases: "v3.4 · 14 Oct 2026 · Schedules in plain English" |
| Type when a job runs; Lamplit writes the cron | Releases v3.4: "Type when a job should run, in words. Lamplit writes the cron…"; the Schedules page: "When each job runs, in plain English. Lamplit writes the cron." |
| "every weekday at 9am" → `0 9 * * 1-5`, next runs Thu 15 Oct to Wed 21 Oct at 09:00 | the New schedule field, typed (captures `sched-01` … `sched-20`) |
| Replay from any step (v3.3) | Releases: "v3.3 · 30 Sep 2026 · Replay from any step" |
| A failed run picks up at the step that failed | Releases v3.3: "A failed run picks up at the step that failed." |
| #4,812 failed at write-ledger with ledger timeout (30s); replay from write-ledger goes Queued → Running → Succeeded while two earlier step results are kept from #4,812 | run #4,812 and its replay (`details/failed`, `queued`, `running`, `succeeded`) |
| Fan-out (v3.2) | Releases: "v3.2 · 16 Sep 2026 · Fan-out" |
| 412 images, one step, one row | run #52,318: resize-images, "fan-out 412 children" in its one `resize` step, payload `images: [ /* 412 */ ]`; Releases v3.2: "The timeline groups the children in one row." |
| Children 340 of 412 done; fan-out · 340 of 412 | the timeline callout for #52,318 (`callout`) and run #52,318 (`proof/fanout-proof`) |
| Up to 10,000 child runs from one step | Releases v3.2 essentials: "Up to 10,000 children per step" |
| Sample releases · v3.2 | The stat is a capacity limit stated in the fictional v3.2 sample release notes, not measured customer usage. |
| All of them on one row | Releases v3.2: "The timeline groups the children in one row." |
| What's new, 3.2 to 3.4 | the three releases shown (v3.2, v3.3, v3.4) and Releases: "You're on 3.4.0, the latest"; the sidebar's `v3.4.0`; v3.4 is the latest of the three releases shown |
| Background jobs for developers. | Lamplit’s category (`cast/lamplit/brand.md`) |
| Every job, in the light. | Lamplit's line (`cast/lamplit/brand.md`) |
| `npm i lamplit@latest` | the package is `lamplit` (brand.md: SDK `import { job } from "lamplit"`; Releases show `npm i lamplit@3.2.0`) |

## Sample data

Lamplit's own sample account only (`pebble-shop`, signed in as Noor). No
customer data; no other company's names or screens.

Style inspired by [@moutaio's video](https://x.com/moutaio/status/2103826041831588016);
an independent style study, not made or endorsed by @moutaio.
