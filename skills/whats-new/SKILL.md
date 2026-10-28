---
name: whats-new
description: >-
  Make a repeatable 20–30 second release video from a product changelog and
  real screens, in wide, square and tall. Use for a what's-new clip, app
  update, release notes video or new version announcement.
---

# What's new

Make the clip a product makes again with every release. Each new feature gets
a beat: its name, one to five words with a full stop ("Fan-out."), a short
line under it, and the real product doing exactly that, zoomed in close.
Then one number that proves the release, counting up. Then the mark, the name
and version, a one-line promise and how to get it, held to the end.

Start from the finished clip in `reference/` (Lamplit 3.4, a fictional
developer tool, wide first; story in `reference/STORY.md`). A second example,
`examples/fernwise/`, is a phone app's update, tall first. Their toolkit
(rising words, product cards, camera, cursor and touch, count-up, open and end
card, music) stays; their words, screens and features become the user's.

Read `style.md` before you build and `critique.md` before you judge.

## Start or resume

- Check Node 20+, ffmpeg and a local Chrome-family browser
  (`scripts/chrome.mjs` finds it; `CHROME_PATH` overrides). Explain anything
  missing.
- Collect: the changes (a changelog, release notes, a list, or a diff of the
  site's changelog page), the product (a URL or a local build it can run),
  the version, and how to get it (an install command, "Update now", a store
  name). Read the changelog and the product before asking; ask once for what
  they can't answer. If the user wants no questions, decide from them.
- If `whats-new/` already exists with `film/STORY.md`, this is a revision or
  the next release: work on that film (a new release keeps the look and
  changes the features, the stat and the version).

Set up a first film:

```bash
mkdir whats-new && cd whats-new
cp -R "$SKILL_DIR/reference" reference && cp -R "$SKILL_DIR/reference" film && cp -R "$SKILL_DIR/scripts" scripts && cp -R "$SKILL_DIR/music" music
rm -rf film/assets/screens* film/assets/proof film/assets/details film/assets/full film/plans
npm init -y >/dev/null && npm i -D puppeteer-core
```

`SKILL_DIR` is this file's folder. For a phone app, start from
`examples/fernwise` instead of `reference`. `reference/` stays untouched, to
compare against.

## Learn the product and its changes, then write the story

1. Choose two to four features from the changes: the ones a user would
   notice, each one something the product visibly does. Skip fixes and
   internals unless one is the release. Name each in one to five plain words
   with a full stop, in the product's own terms; write its line (up to ten
   words: what it does). When the features come from more than one release,
   give each its version label.
2. For each feature, find the moment on the real product that shows it,
   unmistakably: the action and its result, close enough to read. A typed
   field and what it writes; a click and the state it changes; a list before
   and after. Find where that UI lives (a URL, a demo, a sandbox, the user's
   local build) and the states a capture plan can reach by clicks, typing or
   the URL.
3. Choose the stat: one number from the product (on its screens, or in the
   user's own data with their permission) that supports this release, with
   two short lines: what it counts, and what it means. Fill `statSource`
   with a short source displayed on the card. Distinguish a capacity limit,
   an example account and a measured result; never imply adoption from
   sample data.
4. Write `film/STORY.md` in the shape of `reference/STORY.md`: the beats and
   their times on the 100 BPM grid, every word on screen, each feature's
   screen, states and action → result, and a claims table: every word and
   number with its source. Numbers come only from a source you cite.
5. Show the user the plan in a few lines (the features, their names, the
   stat, the ending) and ask for one review, unless they asked for an
   unattended run. Never take silence as approval.

## Capture the real screens

1. Write `film/plans/*.json` in the shape of `reference/plans/` (the format is
   at the top of `scripts/screens.mjs`):
   - every state each feature shows, reached by `click`, `type`, `tap`,
     `eval` (a URL hash) and captured;
   - regions around what the camera frames, with room around them, at scale 3
     (`rect` or `around`) or scale 5 for close text; a typed field as a `type` step, which captures a
     state per letter;
   - `rects`: every element the camera or cursor uses, by name.
   Use the product's own narrower layout (a smaller `viewport`) or its phone
   layout for square and tall where it lets the camera get closer
   (`reference/plans/narrow.json`).
2. Run each plan into its own folder under `film/assets/` and list the
   folders in the film's `SETS`:
   ```bash
   node scripts/screens.mjs film/plans/desktop.json film/assets/screens
   ```
3. Look at every capture. Fix the plan until each state is right (no hover
   left on the wrong control, no half-loaded state). If the UI needs a
   sign-in, ask for a demo account or a public demo, or use the user's own
   screenshots. Never capture customer data, and never draw an imagined UI.

## Build the film

Edit `film/index.html`. Its sections are labelled KEEP and ADAPT. The two
starting films are built differently; follow the part for the one you copied.

**From `reference/` (Lamplit, a web product, dark ground):**

- **ADAPT the colours and fonts:** `NIGHT`, `INK`, `LINE`, `TEXT`, `MUTED` and the one
  accent (`AMBER`), and the fonts in `prepare()`.
- **ADAPT the words:** `DEFAULTS` and `FIELDS`, from `STORY.md`.
- **ADAPT the features:** `TIMING` (one timeline for every shape) and the feature
  objects `F1`, `F2`, `F3` in `timeline()`: each feature's start, its clicks and the
  moments its result changes. `featureCards(f, area, t)` returns the real captures as
  cards (`crop(id, set, shot, source rect, …)`); a card's changes happen inside its own
  elements through `native.events` (`focus` for a press or focus state, `roll` for a value
  that changes, `radial` for a status dot), never as a whole-capture dissolve. A control
  that has done its job leaves where it stands (`exitAt`); a popover grows from the
  control that opened it (`anchor`). Cards never re-centre when their content shrinks.
- **ADAPT the stat:** `statPaint` counts `V.stat` up; the amber field grows out of a real
  element of the last feature (`fieldBounds`, `floodCard`).
- **KEEP** the layouts (`layoutFor`: words on top in tall and square, left in wide, 7%
  margins), the whole-scene pushes between features (`handoffs`, 0.6 s), the house
  motion (`kit.motion`), `markReveal` for the open and the end, and the drawing.

**From `examples/fernwise/` (a phone app, tall first):**

- **ADAPT the colours:** the two grounds (`LIGHT`, `DARK`) and their text
  colours from the brand; `UI_INK` and `UI_LINE` from the product's own page
  and borders; the brand's fonts (licensed, in `assets/fonts/`).
- **ADAPT the brand files:** the mark (and wordmark, if there is one) in
  `assets/brand/`. Drop the mark's glow for a brand without one. Use the
  brand's title font for feature names (Fernwise uses Fraunces and Nunito).
- **ADAPT the words:** `DEFAULTS` and `FIELDS`, from `STORY.md`.
- **ADAPT the features:** one entry per feature (`F1`, `F2`, …): its words,
  ground (alternate light and dark), layout (`beside` for a compact moment,
  `above` for a wide one; square and tall always put the name above), and its
  `views`: the camera's framings over time (page rects, per shape where they
  differ), the capture each moment shows, and the cursor, touch or typing
  that drives it. Clicks and state changes land on beats. Keep each feature
  two bars (4.8 s); move `BEATS` along the grid when you add or remove one.
  With this opening, stat and ending, two features make 20.4 s, three make
  25.2 s, and four make 30 s.
- **KEEP proof readable:** finish on a close view of the real result. Use
  a scale-5 detail capture if necessary; maintain its size when long edits
  enlarge the title. Measure captured UI separately: its critical text must
  reach 28 px at a 1440 px short side. The stress test measures drawn words,
  not text already inside a screenshot. `cleanView` uses an exact crop;
  `detailView` detaches a complete captured element with a 12 CSS px gutter.
  Check the source box as well as the card edge: no partial glyph or icon.
- **KEEP tall top-down:** start the measured title at about y = 160 in a
  1080 × 1920 frame, then put content-sized evidence cards below it, growing
  down to y = 1689.6 (88%). Fit the current crop's aspect, with up to 1048 px
  width (16 px frame margins). Measure visible card bounds: a large allocated
  area does not prove the card fills it. Use the app's own compact panels or stack a control
  and result. A short crop must not shrink the whole scene into the top half.
  Keep a room photo with its full viewfinder and reading, or cut below it.
- **KEEP the pauses** (style.md, "Pauses"): a feature's name and line are in
  before the cursor sets off, the cursor rests about 0.45 s before it
  presses, and the stat's lines get time to read; the product's own working
  keeps its pace. Longer words get a little more room; never pad a beat.
- **ADAPT the cues** (and, with `--music`, the score) in step with the beats.
- **KEEP** the toolkit, the layouts, the open, the stat, the end card and the
  drawing.

Write `PRODUCT.md` at the project root: the product, its URL, the brand
colours, fonts and mark (with licences), the chosen words, the date. The next
release reuses it.

## Review, render, deliver

1. Sheets and phone checks for every shape:
   ```bash
   node scripts/render.mjs film --all --times key --sheet
   node scripts/render.mjs film --all --phone
   ```
   Then 12-frame strips at every card rise, whip, pull and in-card cut, in
   wide and in tall: `node scripts/render.mjs film --size 9:16 --strip <time>`.
2. Score with `critique.md` and fix the worst three problems; repeat. Before
   shipping, get a fresh judgement: if your agent can start a sub-agent
   without this session's memory, give it `critique.md`, `STORY.md` and the
   images, nothing else, and fix what it finds. Otherwise reread
   `critique.md` and score from the images alone. Nothing ships below 8.
   After four rounds, report what remains.
3. The quick test and repeatability:
   `node scripts/render.mjs film --all --check --stress`. It fails when long or
   short words break the layout; read the sheets it writes in
   `out/stress/` as well.
4. Render:
   ```bash
   node scripts/render.mjs film --all --video --blur 4 --audio music/song.mp3 --bpm 120 --sound --poster <time>
   ```
   This writes `out/16x9.mp4`, `out/1x1.mp4` and `out/9x16.mp4`: 60 fps, with
   motion blur, the skill's song and effects, around −14 LUFS. It takes a few minutes:
   run it in the foreground and wait for all three files before handing over.
   The song, `music/song.mp3` (fresh, upbeat indie-dance electronica, 120 BPM,
   made for this skill), is fitted to the film: it starts on a bar line and,
   near the end, lands one hit while the rest closes and fades (its stems in
   `music/song-stems/` let the drums stop on that hit). It's about two minutes
   long in distinct 8-bar sections; `--from <seconds>` starts at another one.
   `--bpm 120` is this song's tempo, which the fitter would otherwise misread a
   little. `--music` instead of `--audio music/song.mp3 --bpm 120` gives the
   synthesised score; the user's own song works the same way with
   `--audio their-song.wav` (drop `--bpm 120`).
5. Run `node scripts/preview.mjs film` and give its localhost address. It plays
   every shape and edits the words; saved edits need a new render to reach
   the MP4s.
6. Write `README.md` (the files, how to preview, how to change a word, how to
   make the next release's clip) and `out/CAPTION.md` (a post under 280
   characters: the version and its features in the product's voice, and how
   to get it). Hand over the MP4s, the posters, the caption, a short check
   summary and any remaining limitation. Put the detailed scores in `out/REVIEW.md`.

## The next release

Copy `film/` to a new folder, keep the colours, brand, layouts and toolkit,
and replace the features, the stat, the version and their captures. Recapture
only what changed.

## Hard rules

- Real screens only, captured; sample data or the user's own, never customer
  data; only the user's brand.
- Every feature's moment shows the product doing exactly what its name says.
- Every word and number on screen has a source in `STORY.md`; version labels
  say truthfully which release each feature came in.
- `seek(t, values)` paints from its arguments only: no clocks, unseeded
  randomness, timers or network. CPU-backed canvases, reset every frame.
- Every file the film loads lives inside `film/`.

## Files

- `reference/`: Lamplit 3.4 (wide first), `STORY.md`, the capture `plans/`,
  the captured screens, the brand's mark, wordmark and fonts (OFL).
- `examples/fernwise/`: Fernwise's app update (tall first), the same parts,
  with a touch instead of a cursor.
- `style.md`: the grammar, with the study's numbers. `critique.md`: the review.
- `scripts/`: `screens.mjs` (real screens in states), `capture.mjs` (brand
  from a URL), `render.mjs` (stills, strips, checks, MP4s), `preview.mjs`,
  `music.mjs`, `song.mjs` (fits a supplied song), `sfx.mjs` with the sound kit, and `chrome.mjs`.
- `music/`: the skill's song and its stems.

Lamplit and Fernwise are fictional companies made for omnigami's examples.

This skill is omnigami's (https://omnigami.ai), © 2026 Auberon LLC. Use what it makes for anything,
commercial work included, and change the skill for your own use; don't redistribute or
sell the skill. Full terms: https://github.com/omnigami-ai/skills/blob/main/LICENSE.md
