# Lamplit: what's new

A **27.9 s**, 60 fps release clip for Lamplit, a fictional background-jobs
product for developers made for omnigami’s examples, in a night-and-amber
palette. All three shapes share one timeline; the score is at 120 BPM.

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

The current timing (re-timed 2026-10-22 with pauses where the viewer needs them; style.md, "Pauses"). The
times in later notes and in the history below are from earlier revisions.

| Time | Beat | Words and evidence | Motion |
| --- | --- | --- | --- |
| 0–3.2 | Open | lamplit · “Background jobs for developers.” · “What’s new, 3.2 to 3.4” | Generic `markReveal` (already growing on frame 0), lockup at 0.45; the release line rises at 1.0 and both lines read for 1.5–2 s. Scene push 2.9–3.5. |
| 3.2–9.5 | v3.4 | “Schedules in plain English.” · “Type when a job runs. Lamplit writes the cron.” | Title and the field, cron and next-run cards enter with the push (2.7–2.9). Once the line is in, the cursor sets off (4.28), is on the field about half a second and presses at 5.1; the phrase types 5.5–6.6 and 6.8–7.3; the app understands it on the 13th letter (6.58) and the cron and next runs roll in, the hour rolling over at “9”. Final result in by 7.9, held to the push (9.2). |
| 9.5–15.7 | v3.3 | “Replay from any step.” · “A failed run picks up at the step that failed.” | Button and Details enter with the push. The cursor sets off at 10.48, rests on the button about half a second and presses at 11.3 (the real held capture); Queued 11.42; the button leaves (11.85) as the two kept-step badges arrive; Running 12.9, Succeeded 14.15, held to the push (15.4). |
| 15.7–20.1 | v3.2 | “Fan-out.” · “412 images, one step, one row.” | The timeline enters with the push. The cursor sets off at 16.48, rests about half a second and presses the running bar at 17.3 (the app’s white ring); its popover opens just under it (17.42) and reads to 19.5, when the amber bar’s square field widens, then opens to full bleed. |
| 20.1–24.2 | Capacity | “Up to 10,000” · “child runs from one step.” · “All of them on one row.” · “Sample releases · v3.2” | The count runs 19.97–21.07; the lines rise at 20.7, 21.2 and 21.7 and hold 2.4 s once the last is in. Source labels the fictional release capacity, not adoption. |
| 24.2–24.8 | Straight dark push | Amber gives way to the end | One horizontal dark edge moves up on `inOut` over 0.6 s. |
| 24.8–27.9 | Update | lamplit · “Every job, in the light.” · `$ npm i lamplit@latest` | Generic `markReveal` behind the edge, lockup at 24.9, the command pill at 25.4; held to the end (2.1 s on the command). |

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
least `max(1.0 s, words × 0.4 / 3)` after landing; the longer 27.9 s duration
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
