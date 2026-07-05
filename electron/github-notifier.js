'use strict';

const https = require('https');

const GITHUB_API_HOST = 'api.github.com';
const POLL_INTERVAL_MS = 60_000;
const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;
const STATE_KEY = 'githubPollState'; // { "owner/repo": { prsSince, runsSince } }
const MAX_EVENTS_PER_TYPE = 5; // cap catch-up bursts after downtime
const PR_TITLE_MAX = 80;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests) — no I/O, no timers.
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "owner/repo" -> { owner, repo }, or null if malformed. Kept strict so we only
// ever build api.github.com/repos/<owner>/<repo> paths from trusted segments.
function parseRepoSlug(slug) {
  if (typeof slug !== 'string') return null;
  const match = slug.trim().match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match) return null;
  const [, owner, repo] = match;
  // Reject dot-only segments ('.', '..') so a slug can never build a
  // path-traversing api.github.com/repos/../… URL.
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  return { owner, repo };
}

// From GET /repos/{o}/{r}/pulls?state=closed — the ones actually merged after
// `sinceIso`, oldest first so notifications read chronologically.
function selectNewMergedPRs(prs, sinceIso) {
  if (!Array.isArray(prs)) return [];
  return prs
    .filter((pr) => pr && typeof pr.merged_at === 'string' && pr.merged_at > sinceIso)
    .sort((a, b) => (a.merged_at < b.merged_at ? -1 : a.merged_at > b.merged_at ? 1 : 0));
}

// From GET /repos/{o}/{r}/actions/runs?status=completed — completed after
// `sinceIso`, oldest first.
function selectNewCompletedRuns(runs, sinceIso) {
  if (!Array.isArray(runs)) return [];
  return runs
    .filter((r) => r && r.status === 'completed' && typeof r.updated_at === 'string' && r.updated_at > sinceIso)
    .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0));
}

// Newest timestamp among items (by `field`), or the fallback if none.
function latestTimestamp(items, field, fallback) {
  let max = fallback;
  for (const item of items) {
    const t = item?.[field];
    if (typeof t === 'string' && t > max) max = t;
  }
  return max;
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatPrMergedLine(slug, pr) {
  const who = pr.user?.login ? ` by ${escapeHtml(pr.user.login)}` : '';
  return `✅ Merged ${escapeHtml(slug)} #${pr.number} ${escapeHtml(truncate(pr.title, PR_TITLE_MAX))}${who}`;
}

function formatBuildLine(slug, run) {
  const icon = run.conclusion === 'success' ? '🟢' : run.conclusion === 'failure' ? '🔴' : '⚪';
  const branch = run.head_branch ? ` (${escapeHtml(run.head_branch)})` : '';
  return `${icon} Build ${escapeHtml(run.conclusion || 'done')} ${escapeHtml(slug)} · ${escapeHtml(truncate(run.name || 'workflow', 60))}${branch}`;
}

function buildDigestMessage(lines) {
  if (!lines.length) return '';
  return `🔔 <b>Nock Terminal — GitHub</b>\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Default HTTP fetch (injectable for tests).
// ---------------------------------------------------------------------------

function defaultFetchJson(apiPath, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: GITHUB_API_HOST,
        path: apiPath,
        method: 'GET',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'nock-terminal',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_GITHUB_RESPONSE_BYTES) {
            req.destroy(new Error('GitHub response too large'));
            return;
          }
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub API ${res.statusCode} for ${apiPath}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid GitHub JSON: ${err.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out')));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// The poller.
// ---------------------------------------------------------------------------

class GitHubNotifier {
  constructor({
    settingsStore,
    stateStore,
    notifier,
    fetchJson = defaultFetchJson,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  }) {
    this.settingsStore = settingsStore;
    this.stateStore = stateStore;
    this.notifier = notifier;
    this.fetchJson = fetchJson;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.pollTimer = null;
    this.polling = false;
  }

  _getToken() {
    return this.settingsStore?.get('githubToken') || '';
  }

  _getRepos() {
    const repos = this.settingsStore?.get('githubWatchRepos');
    return Array.isArray(repos) ? repos : [];
  }

  _wantsPRs() {
    return this.settingsStore?.get('telegramNotifyPrMerged') !== false;
  }

  _wantsBuilds() {
    return this.settingsStore?.get('telegramNotifyBuildComplete') !== false;
  }

  // Poll only when it could plausibly produce a notification.
  isActive() {
    if (!this.notifier?.isEnabled?.()) return false;
    if (!this._getToken()) return false;
    if (this._getRepos().length === 0) return false;
    return this._wantsPRs() || this._wantsBuilds();
  }

  start() {
    this.stop();
    // Poll once now (establishes baselines for new repos), then on an interval.
    this._pollOnce().catch((err) => console.error('GitHubNotifier: initial poll failed:', err.message));
    this.pollTimer = this.setIntervalFn(() => {
      this._pollOnce().catch((err) => console.error('GitHubNotifier: poll failed:', err.message));
    }, POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }
  }

  restart() {
    if (this.pollTimer) this.start();
  }

  _loadState() {
    const raw = this.stateStore?.get(STATE_KEY);
    return raw && typeof raw === 'object' ? { ...raw } : {};
  }

  _saveState(state) {
    this.stateStore?.set(STATE_KEY, state);
  }

  async _pollOnce() {
    if (this.polling) return;
    if (!this.isActive()) return;
    // Quiet hours: skip the whole cycle (don't advance baselines) so events are
    // caught up after quiet hours rather than silently dropped.
    if (this.notifier.isQuietHours?.()) return;

    this.polling = true;
    try {
      const token = this._getToken();
      const state = this._loadState();
      const nowIso = new Date(this.now()).toISOString();
      const lines = [];

      for (const slug of this._getRepos()) {
        const parsed = parseRepoSlug(slug);
        if (!parsed) continue;
        const repoState = state[slug] || {};

        // First time we see a repo: baseline at now, notify nothing pre-existing.
        if (!repoState.prsSince || !repoState.runsSince) {
          state[slug] = { prsSince: repoState.prsSince || nowIso, runsSince: repoState.runsSince || nowIso };
          continue;
        }

        try {
          if (this._wantsPRs()) {
            const prs = await this.fetchJson(
              `/repos/${parsed.owner}/${parsed.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
              token
            );
            const fresh = selectNewMergedPRs(prs, repoState.prsSince).slice(0, MAX_EVENTS_PER_TYPE);
            for (const pr of fresh) lines.push(formatPrMergedLine(slug, pr));
            repoState.prsSince = latestTimestamp(fresh, 'merged_at', repoState.prsSince);
          }
          if (this._wantsBuilds()) {
            const body = await this.fetchJson(
              `/repos/${parsed.owner}/${parsed.repo}/actions/runs?status=completed&per_page=20`,
              token
            );
            const runs = body && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
            const fresh = selectNewCompletedRuns(runs, repoState.runsSince).slice(0, MAX_EVENTS_PER_TYPE);
            for (const run of fresh) lines.push(formatBuildLine(slug, run));
            repoState.runsSince = latestTimestamp(fresh, 'updated_at', repoState.runsSince);
          }
          state[slug] = repoState;
        } catch (err) {
          // Leave this repo's `since` untouched so we retry next cycle.
          console.error(`GitHubNotifier: ${slug} poll failed:`, err.message);
        }
      }

      this._saveState(state);

      // One digest per cycle (60s apart) — sidesteps the notifier's 5s rate
      // limit that would otherwise drop all but the first line.
      const message = buildDigestMessage(lines);
      if (message) {
        await this.notifier.send(message);
      }
    } finally {
      this.polling = false;
    }
  }
}

module.exports = GitHubNotifier;
module.exports.parseRepoSlug = parseRepoSlug;
module.exports.selectNewMergedPRs = selectNewMergedPRs;
module.exports.selectNewCompletedRuns = selectNewCompletedRuns;
module.exports.latestTimestamp = latestTimestamp;
module.exports.formatPrMergedLine = formatPrMergedLine;
module.exports.formatBuildLine = formatBuildLine;
module.exports.buildDigestMessage = buildDigestMessage;
