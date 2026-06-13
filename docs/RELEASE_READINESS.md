# Release Readiness

Updated: 2026-06-12

Nock Terminal has a release pipeline, but public distribution should stay gated until the checks below pass on a tagged release and the signed installers are smoked on each target OS.

Phase H is the release-readiness execution wave. See `docs/PHASE_H_EXECUTION_PLAN.md` for task ordering. Nock #123 now tracks the real distribution work: signed artifact smoke, credential setup, update-channel decision, crash/error reporting, support path, and beta feedback.

## Current Release Posture

Nock Terminal is private-alpha distributable only. The automated release gates are materially better than the first audit found, but the app is not public-beta ready until signed artifact evidence exists for the actual release installers.

What is automated today:

- Local release preflight through `npm run release:check`.
- Pull-request and `main` CI coverage for tests, Vite build, bundle budgets, and Linux unpacked packaged smoke.
- Tag-triggered release workflow that requires signing secrets, builds macOS/Windows/Linux artifacts, emits checksums, and uploads release assets.

What is still manual or externally blocked:

- Real macOS and Windows signing/notarization credentials must be installed in GitHub Actions before tag release proof can run.
- Clean macOS, Windows, and Linux machines or VMs must smoke the signed release artifacts, not just the unpacked Linux CI app.
- Public beta still needs one published support route, one feedback route, and a privacy-safe crash/error reporting posture.
- No auto-update channel should be enabled until signed artifact smoke, rollback, and support response paths have been exercised.

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

For packaged launch coverage, run:

```bash
npm run smoke:package
```

The packaged smoke builds an unpacked app with `electron-builder --dir`, launches the packaged binary with an isolated user-data directory, waits for the renderer-ready smoke marker, verifies the packaged renderer rendered the Nock Terminal shell, and exits cleanly. CI runs this on Linux under `xvfb`.

## GitHub Release Gate

`.github/workflows/release.yml` runs on `v*.*.*` tags and now requires:

- A Linux preflight job running the full local release gate.
- macOS signing and notarization secrets before building the DMG.
- Windows signing secrets before building the NSIS installer.
- Linux AppImage and deb builds.
- SHA-256 checksum files for every platform artifact.
- GitHub Release upload of macOS, Windows, Linux, and checksum artifacts.

`.github/workflows/ci.yml` also runs an unpacked packaged-app smoke on Linux for pull requests and `main` pushes. This catches packaged renderer/load regressions before a tagged release, while signed installer verification remains a release-machine/manual target-OS check.

Required GitHub secrets:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

## Signed Installer Smoke Checklist

Before a public beta announcement, install the generated artifacts on clean machines or VMs and verify:

- App launches without security or trust warnings beyond the expected first-run OS prompts.
- macOS app is signed and notarized: `spctl --assess --type execute --verbose /Applications/Nock\ Terminal.app`.
- Windows installer publisher is correct and SmartScreen does not show an unsigned-app warning.
- Linux AppImage launches and the deb package installs cleanly.
- First-run onboarding can detect dev roots, Claude/Codex CLI availability, project context files, and Ollama status.
- Session discovery shows Claude transcript projects and recent Codex rollout transcript projects without reading whole transcript files at startup.
- Terminal tab opens in the selected shell and respects shell arguments and environment variables.
- `Ctrl+K` command launcher opens, searches repos/agents, launches trusted project-profile targets, attaches proven CRM tmux agents, and opens fallback-discovered untrusted agent folders without auto-running config commands.
- Persistent CRM agents without shell aliases attach through the canonical tmux fallback, such as `tmux attach -t crm-default-cooper`.
- Local agent-folder `launch_command` values remain visible but disabled from auto-run unless explicitly trusted.
- Claude, Codex, Gemini, and custom-agent profile launch commands use the configured project command when present.
- Task staging opens a fresh agent terminal and places task text in the terminal without auto-submitting it.
- Codex/DeepSeek dispatch agents appear once each, show `DISPATCH`, and do not duplicate from copied dispatch worktrees.
- Clicking a Codex/DeepSeek dispatch agent opens task staging with that agent selected instead of opening a plain folder terminal.
- Brokered dispatch sends a NockCC AgentMessage to Mira when NockCC is configured.
- Brokered dispatch run rows expand to show the correlated request-level NockCC AgentMessage thread, and fail quietly when NockCC is offline.
- Direct dispatch creates a sanitized temp payload file, schedules cleanup, and opens a terminal running the resolved per-agent alias or canonical CRM dispatch script.
- Monaco can open, edit, save, and protect unsaved changes on close.
- Context monitor reports `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Codex config, and `.nock/config.toml` accurately.
- NockCC heartbeat reports active project and agent session counts when configured.
- Telegram/notification settings remain opt-in, stored credentials stay main-process-only, and the Settings screen exposes only configured/not-configured secret status.
- NockCC API key configuration remains main-process-only; renderer settings reads, exports, and compatibility secure-read calls must not return raw credentials.

## Signed Artifact Evidence Ledger

Record real release evidence here. Do not fill this table from CI-only unpacked smoke results; these rows are for signed or release-candidate artifacts installed on target OSes.

| Platform | Artifact | Checksum | Source build | Machine / OS | Operator | Date | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | Not run | Not recorded | Blocked pending signing/notarization credentials | Clean macOS machine or VM required | TBD | TBD | Blocked | Must verify notarized DMG install plus `spctl --assess --type execute --verbose /Applications/Nock\ Terminal.app`. |
| Windows | Not run | Not recorded | Blocked pending Windows signing credentials | Clean Windows machine or VM required | TBD | TBD | Blocked | Must verify publisher identity and SmartScreen behavior for the signed NSIS installer. |
| Linux AppImage | Not run | Not recorded | Release artifact required | Clean Linux machine or VM required | TBD | TBD | Blocked | CI runs unpacked Linux smoke, but public beta still needs AppImage launch evidence. |
| Linux deb | Not run | Not recorded | Release artifact required | Clean Linux machine or VM required | TBD | TBD | Blocked | Must verify install, launch, and uninstall behavior on a clean Debian/Ubuntu-family target. |

## Manual Smoke Protocol

Use this protocol for every row in the evidence ledger:

1. Build from a tag or release candidate branch, not an untracked local tree.
2. Record artifact filename, SHA-256 checksum, build run URL or local build command, target OS version, machine/VM identifier, operator, and date.
3. Install the artifact on a clean machine or VM with no existing Nock Terminal user data.
4. Run the checklist above, including first-run onboarding, terminal launch, command launcher, file editing, dispatch staging, NockCC heartbeat, and notification privacy checks.
5. Record failures as failures. If the issue is fixed, add a new ledger row for the replacement artifact instead of editing history into success.

## Release Decision

Private alpha is acceptable when the local release gate passes and CI packaged smoke is green. Distribution should remain direct and limited while signed artifact evidence is missing.

Public beta is blocked until all of the following are true:

- Signed installer smoke results exist for macOS, Windows, Linux AppImage, and Linux deb release artifacts.
- macOS and Windows signing/notarization credentials are configured in the release workflow and proven by a tagged run.
- The update policy is published as manual GitHub Releases only, or a tested auto-update channel exists with rollback instructions.
- Crash/error reporting is either implemented with an explicit privacy posture or deliberately deferred with a documented support-log fallback.
- A public support route and beta feedback route are live and included in release notes or onboarding material.
- One clear public demo path exists around agent observability, not generic chat.

Current decision: no auto-update and no silent telemetry for private alpha. Use manual GitHub Releases/direct artifact sharing, direct operator support, and user-initiated diagnostics until the signed artifact path is proven.

## Phase H Decision Log

Record Phase H decisions here as they are made:

| Area | Decision | Owner | Evidence |
| --- | --- | --- | --- |
| Update channel | Private alpha uses manual GitHub Releases or direct artifact sharing. Public beta must stay manual unless a signed, tested auto-update channel and rollback flow land first. | Kevin / Mira | Nock #123, this document |
| Crash/error reporting | No silent third-party crash/error reporting before public beta. Use direct user reports and user-initiated diagnostics until a privacy posture and provider are chosen. | Kevin / Mira | Nock #123, this document |
| Support path | Private alpha support is direct through Kevin/Mira/NockCC coordination. Public beta is blocked until a public support route exists, such as GitHub Issues or a support mailbox. | Kevin / Mira | Nock #123, this document |
| Beta feedback channel | Private alpha feedback is direct/NockCC. Public beta needs a published feedback route linked from release notes or onboarding. | Kevin / Mira | Nock #123, this document |
| Signed artifact smoke | Blocked pending real signing credentials and clean target OS machines/VMs. CI unpacked Linux smoke is useful but not a substitute. | Kevin / release operator | Evidence ledger above |

## Rollback

If a release is bad:

1. Mark the GitHub release as pre-release or delete the latest release assets.
2. Publish a short issue or release note explaining the affected versions and workaround.
3. Cut a patch tag after the release gate passes.
4. Keep checksum files with every replacement artifact.
