# What's new: critique

Judge the clip as a stranger seeing it in a feed, with the sound off first.
It has one job: in 20–30 seconds, show what changed in this release, each
change working on the real product, and how to get it.

Look at: the key-frame sheet of every shape (`--all --times key --sheet`), the
phone sheet of every shape (`--all --phone`), 12-frame strips at every card
rise, whip, pull and cut inside a card (`--strip <t>`, in wide and in tall),
the MP4 twice (once for the picture, once for the sound), and `STORY.md`'s
claims.

## Score each 1–10

1. **Clarity:** with the sound off, could a stranger say what product this
   is (by the end of the open), what each new feature does (its name, its
   line and its product moment agree), what the number proves, and how to
   get the release (on screen to the last frame)?
2. **Proof:** each feature's product moment shows the product doing exactly
   what its name says, unmistakably: the action (typing, a click) and the
   result both in view, in the region the camera zooms into. A feature you
   have to take on trust scores low.
3. **Truth:** every screen is a real capture; every word and number on
   screen has a source in `STORY.md`; version labels are right about which
   release each feature came in; sample data only.
4. **Type:** names big and confident, a full stop each; lines short and grey;
   the version label small; every word rises from its mask; nothing over the
   product; balanced line breaks; nothing too small for a phone.
5. **Motion:** words rise on the beat; the card rises on a spring with a
   little overshoot; whips land soft, pulls are front-loaded; the camera
   holds still while the cursor clicks; nothing stops dead; the count-up is
   fast first and settles.
6. **Readability:** on every shape's phone sheet, every word of the film is
   readable, and the product text that carries the feature (the typed words,
   the status, the number on screen) can be read; nothing under the floor
   (2.4% of the short side for the film's own words).
7. **Shapes:** each shape is laid out for its frame, not cropped: beside or
   above in wide, above in square and tall, cards sized to what they show,
   no large empty bands, nothing cut by the frame.
8. **Rhythm and sound:** cuts and clicks land on beats; a sound on every
   action; the count-up ticks; the song lands one hit near the end and closes
   (with `--music`, a breath before the stat and the end); loudness around
   −14 LUFS.
9. **Craft and brand:** looks like a top studio's release clip for this
   brand: its colours, mark, fonts and voice; two grounds, alternating;
   nothing clip-art, cartoonish, template-like or cheap.

## Hunt for

- **Breathing room** (a failure here caps the film at 7): an action the viewer can't follow on one viewing: a click within half a second of the camera or cursor arriving, a result gone in under a second, a caption or headline replaced before it can be read. Lengthen the film rather than compress the holds.
- **Type centred in its container** (pills, buttons, chips, badges, a word beside a mark): the capitals sit on the container's centre line, measured, not by eye. Words that ride high are the usual fault (textBaseline 'middle' and CSS line boxes both centre the font's em box, not the letters); draw with `kit.centreText`, and in HTML use `text-box: trim-both cap alphabetic` with equal padding. The quick test fails canvas text set with 'middle'; captured screens and HTML are checked on the stills.
- **The film's own shapes, finished:** every click has a press state on its visual onset (what's pressed sinks a few percent and lights or darkens, then comes back), and a held control shows it's held; apertures and reveals are clean circles or the product's own shapes, never blades or drawn lines; a shape that becomes another does it in one continuous move, not a chain of in-between shapes; a pulse is one thin ring that thins as it grows; nothing (a check, a label, an icon) vanishes or appears in a single frame at a hand-off: it moves, shrinks or is covered. Check each on a strip of consecutive frames from the MP4.
- a name whose product moment shows something else, or shows it too small
  or too briefly to read;
- a result that happens off screen (the camera elsewhere when the state
  changes);
- a capture shown past its sharpness (soft text), or a card that shows the
  empty space past the edge of a capture;
- a card cut by the frame, or half a word of UI at a card's top edge where a
  framing sits badly;
- a version label that claims a feature for the wrong release;
- a stat that repeats a feature without adding anything, or that has no
  source;
- text over text, a name that wraps to an orphan, a line cut by the frame;
- a cursor covering what it clicks, or moving while the camera whips;
- a frame where nothing can be read (between moves is fine, a hold is not);
- the install line or ask leaving before the end;
- fades between beats, decorative flourishes, anything that looks stock;
- another product's words, features, screens or logo.

For each issue write the shape, the time, what's wrong and the exact fix
("tall, 10.2 s: the replay's status is off the card's right edge: frame
[248, 92, 480, 430] instead"). Fix the worst three, review again, score
again. Nothing ships below 8. After four rounds, report what remains instead
of claiming the clip is finished.

With each fix, write what it must keep (the timing, sizes and moves already
right) and the times to look at again; look at them, and at the cuts either
side, before scoring again. If the same problem survives two fixes, stop
fixing it and report it with what you tried. Never loosen a check, a size
floor or the bar to get a pass.
