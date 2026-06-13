# DESIGN.md — Nock Terminal

Source of truth: `tailwind.config.js` (`nock` palette) and `src/index.css`. This file documents intent.

## Color

Near-black surfaces with a faint blue cast; never pure black or white.

- Surfaces: `bg #08080D` → `bg-elevated #0C0C14` → `card #0E0E16` → `card-hover #13131E`
- Borders: `#1A1A2A`, bright variant `#262640`
- Brand pair (logo gradient): blue `#3B6FD4`, purple `#7C5CFC`
- Telemetry accents (meaningful, not decorative): cyan `#00E5FF` = live/active, amber `#FFB020` = warning, green `#34D399` = healthy, red `#F87171` = failed/disabled
- Text: `#E8E8F0` / dim `#8A8AA0` / muted `#4A4A5E`
- Strategy: Restrained. Accents stay under ~10% of any surface and always encode state.

## Typography

- Body/UI: Sora. Display (sparingly, headers like "Sessions"): Chakra Petch. Data/telemetry: JetBrains Mono.
- Telemetry labels: mono, 9–10px, uppercase, `tracking-widest`, muted color — the signature texture.
- Editorial section markers: `// 01 — Fleet Overview` style, cyan, mono.
- Dense by design; data surfaces may run small but never below 9px.

## Components and texture

- Cards: 1px full borders, subtle hover elevation (`shadow-card-hover`), never side-stripe accents.
- Status dots with glow (`status-dot` + glow shadows) communicate lifecycle: LIVE/RECENT/IDLE, RUNNING/STALE/DISPATCH/OFFLINE/DISABLED.
- Grid scan-line backgrounds at 3% opacity for the header band only.
- Stagger-reveal on card grids (`stagger-reveal`), 150–250ms transitions, ease-out only.

## Motion

State-conveying only. `fade-in 0.4s`, `slide-up 0.5s cubic-bezier(0.16,1,0.3,1)`, `pulse-glow` reserved for genuinely live indicators. No page-load choreography beyond the card stagger.
