// Renderer crash/hang recovery decision logic.
//
// A dead renderer process leaves a blank, frozen window — the app reads as
// "crashed or froze" even though the main process is healthy. The main process
// can recover by reloading the window, but a genuinely broken renderer must not
// be reloaded forever: an unbounded reload loop pegs the CPU and never settles.
//
// This module is the pure, unit-testable policy: given the crash reason and the
// recent crash history, decide whether to reload, give up, or ignore. main.js
// owns the Electron wiring (attaching the handler, calling reload) so this stays
// bootable-free and testable without Electron.

const RECOVERY_DEFAULTS = {
  // Reload up to this many times inside the rolling window before giving up.
  maxCrashes: 3,
  // Rolling window for counting crashes toward the cap.
  windowMs: 60_000,
};

// Reasons that represent a normal, expected renderer teardown rather than a
// fault — never treat these as a crash worth recovering from.
const NORMAL_EXIT_REASONS = new Set(['clean-exit']);

// Decide how to respond to a renderer process going away.
//
//   { action: 'ignore' | 'reload' | 'giveup', crashTimestamps, attempt? }
//
// `crashTimestamps` is the updated history to persist for the next call. On a
// reload it also carries `attempt` (1-based count within the window).
function decideRendererRecovery({
  reason,
  crashTimestamps = [],
  now,
  maxCrashes = RECOVERY_DEFAULTS.maxCrashes,
  windowMs = RECOVERY_DEFAULTS.windowMs,
} = {}) {
  if (NORMAL_EXIT_REASONS.has(reason)) {
    return { action: 'ignore', crashTimestamps };
  }

  // Drop crashes that fell out of the rolling window, then record this one.
  const recent = crashTimestamps.filter((t) => now - t < windowMs);
  recent.push(now);

  if (recent.length > maxCrashes) {
    return { action: 'giveup', crashTimestamps: recent };
  }
  return { action: 'reload', crashTimestamps: recent, attempt: recent.length };
}

module.exports = {
  RECOVERY_DEFAULTS,
  NORMAL_EXIT_REASONS,
  decideRendererRecovery,
};
