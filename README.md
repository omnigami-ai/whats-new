# What’s new · omnigami

A release video you can make again with every version.

Give it your changelog and your product. Each new feature gets a beat: its name, one line, and your real product doing exactly that, close up. Then one number that proves the release counts up, and your mark, the version and how to get it. You keep the film, so the next release only changes the features.

Watch it play live, and change its words, at [omnigami.ai/skills/whats-new](https://omnigami.ai/skills/whats-new).

## Install

In Claude Code:

```
/plugin marketplace add omnigami-ai/skills
/plugin install omnigami-whats-new@omnigami
```

With the skills CLI, for Claude Code and other agents that read SKILL.md:

```bash
npx skills add omnigami-ai/whats-new
```

Or copy `skills/whats-new/` into your agent's skills folder (for Claude Code, `~/.claude/skills/whats-new/`). Then ask:

```
Make a what’s-new video for our latest release of https://your-product.com
```

## What it runs

The skill works on your computer. It runs the Node scripts in `skills/whats-new/scripts/`: they open your product's pages in a local headless browser to capture its real screens, then render the film with that browser and ffmpeg, writing MP4s and an editable HTML film to your project. It sends nothing to omnigami or anyone else, and uses no network beyond loading your own product's pages and the fonts and assets in this folder.

## You need

- Claude Code with Opus 5.5
- Node 20 or later
- ffmpeg
- Chrome, Chromium, Edge or Brave

None beyond your Claude plan’s usage. Node, ffmpeg and the browser are free.

## Licence

Free to use. Use the films and anything else the skill makes for anything, commercial work included. Don't redistribute the skill. See [LICENSE.md](LICENSE.md). The bundled fonts keep their own licence (SIL Open Font License, beside them in `reference/assets/fonts/`).

## Credits

Its example shows Lamplit, a fictional company made for omnigami’s examples, with sample data.

omnigami is not affiliated with Anthropic. More skills at [omnigami.ai](https://omnigami.ai).
