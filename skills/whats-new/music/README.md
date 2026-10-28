# Music

`song.mp3` is this skill's song: an instrumental in fresh, upbeat indie-dance electronica at 120 BPM, made for this skill by omnigami with AI. `song-stems/` holds its stems (`drums.m4a`, `rest.m4a`), split from it with Demucs.
`node scripts/render.mjs film --audio music/song.mp3 --bpm 120` fits it to the film (`--bpm 120` is the song's tempo, which the fitter would otherwise misread; drop it for another song): it starts on a bar line and, near the end, the drums land one hit and stop while the rest closes and fades. `--from <seconds>` starts at another section.
Usage terms: see the skill's licence.
