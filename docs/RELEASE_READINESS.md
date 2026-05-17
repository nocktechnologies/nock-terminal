# Release Readiness

Updated: 2026-05-16

Nock Terminal has a release pipeline, but public distribution should stay gated until the checks below pass on a tagged release and the packaged installers are manually smoked on each target OS.

## Local Release Gate

Run this before cutting a release branch or tag:

```bash
npm run release:check
```

The gate runs:

- `npm test`
- `npm audit --audit-level=moderate`
- `npx vite build`
- `npm run check:bundle`

The bundle budget accepts the known Monaco worker sizes but blocks unexpected growth in the app entry chunk, editor API chunk, Monaco workers, and xterm chunk.

## GitHub Release Gate

`.github/workflows/release.yml` runs on `v*.*.*` tags and now requires:

- A Linux preflight job running the full local release gate.
- macOS signing and notarization secrets before building the DMG.
- Windows signing secrets before building the NSIS installer.
- Linux AppImage and deb builds.
- SHA-256 checksum files for every platform artifact.
- GitHub Release upload of macOS, Windows, Linux, and checksum artifacts.

Required GitHub secrets:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

## Packaged Smoke Checklist

Before a public beta announcement, install the generated artifacts on clean machines or VMs and verify:

- App launches without security or trust warnings beyond the expected first-run OS prompts.
- macOS app is signed and notarized: `spctl --assess --type execute --verbose /Applications/Nock\ Terminal.app`.
- Windows installer publisher is correct and SmartScreen does not show an unsigned-app warning.
- Linux AppImage launches and the deb package installs cleanly.
- First-run onboarding can detect dev roots, Claude/Codex CLI availability, project context files, and Ollama status.
- Terminal tab opens in the selected shell and respects shell arguments and environment variables.
- `Ctrl+K` command launcher opens, searches repos/agents, and launches the selected target.
- Claude, Codex, Gemini, and custom-agent profile launch commands use the configured project command when present.
- Task staging opens a fresh agent terminal and places task text in the terminal without auto-submitting it.
- Codex/DeepSeek dispatch agents appear once each, show `DISPATCH`, and do not duplicate from copied dispatch worktrees.
- Brokered dispatch sends a NockCC AgentMessage to Mira when NockCC is configured.
- Direct dispatch creates a temp payload file and opens a terminal running the correct CRM dispatch script.
- Monaco can open, edit, save, and protect unsaved changes on close.
- Context monitor reports `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Codex config, and `.nock/config.toml` accurately.
- NockCC heartbeat reports active project and agent session counts when configured.
- Telegram/notification settings remain opt-in and do not leak local project details without user configuration.

## Release Decision

Private alpha is acceptable when the local release gate passes and at least one packaged artifact per target OS has passed the smoke checklist.

Public beta still needs:

- Packaged smoke tests automated in CI.
- Crash/error reporting decision and support path.
- Update-channel decision.
- One clear public onboarding/demo path around agent observability, not generic chat.

## Rollback

If a release is bad:

1. Mark the GitHub release as pre-release or delete the latest release assets.
2. Publish a short issue or release note explaining the affected versions and workaround.
3. Cut a patch tag after the release gate passes.
4. Keep checksum files with every replacement artifact.
