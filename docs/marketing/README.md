# Nock Terminal Marketing Screenshots

These screenshots use the real React UI with sanitized mock agent/repo data. They are safe for public marketing drafts and avoid leaking local terminal output, private paths, or client work.

## Screenshot Set

- `screenshots/01-dashboard-fleet-overview.png` - hero cockpit view: agents, repos, operations panel, context health.
- `screenshots/02-repo-agent-search.png` - repo/agent search as the speed-to-context proof point.
- `screenshots/03-command-launcher-task-staging.png` - DeepSeek dispatch routed through Mira.
- `screenshots/04-agent-terminal-launch.png` - persistent agent terminal/tmux launch flow.
- `screenshots/05-agent-agnostic-launch-profile.png` - Codex launch and task staging for a repo.

## Brand Candidate Preview

- `brand-logo-candidates.png` - rendered preview of the terminal SVG exports before app icon replacement.

Selected product assets:

- App/package icon source: `assets/brand/n_terminal_icon_dark.svg`
- Menu-bar/tray source: `assets/brand/n_terminal_icon_glyph_only.svg`
- Marketing dark lockup: `assets/brand/nock_terminal_lockup_dark.svg`
- Marketing light lockup: `assets/brand/nock_terminal_lockup_light.svg`

Current source folder discovered locally:

```text
/Users/kevin/Downloads/Brand Logos/exports/terminal
```

## Regenerate

Start the renderer dev server:

```bash
npm run dev
```

Then run:

```bash
python3 scripts/capture-marketing-screenshots.py
```
