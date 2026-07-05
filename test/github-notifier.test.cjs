const test = require('node:test');
const assert = require('node:assert/strict');

const GitHubNotifier = require('../electron/github-notifier');
const {
  parseRepoSlug,
  selectNewMergedPRs,
  selectNewCompletedRuns,
  latestTimestamp,
  formatPrMergedLine,
  formatBuildLine,
  buildDigestMessage,
} = GitHubNotifier;

// ---- pure helpers ----

test('parseRepoSlug accepts owner/repo and rejects anything else', () => {
  assert.deepEqual(parseRepoSlug('nocktechnologies/nock-terminal'), {
    owner: 'nocktechnologies',
    repo: 'nock-terminal',
  });
  for (const bad of ['noslash', 'too/many/slashes', 'a b/c', '', null, '../etc', 'o/r?x']) {
    assert.equal(parseRepoSlug(bad), null, `expected reject: ${bad}`);
  }
});

test('selectNewMergedPRs keeps only merged PRs after the cursor, oldest first', () => {
  const prs = [
    { number: 3, title: 'c', merged_at: '2026-07-05T12:00:00Z' },
    { number: 2, title: 'b', merged_at: null }, // closed, not merged
    { number: 1, title: 'a', merged_at: '2026-07-05T09:00:00Z' }, // at/before cursor
    { number: 4, title: 'd', merged_at: '2026-07-05T11:00:00Z' },
  ];
  const fresh = selectNewMergedPRs(prs, '2026-07-05T09:00:00Z');
  assert.deepEqual(fresh.map((p) => p.number), [4, 3]);
});

test('selectNewCompletedRuns keeps completed runs after the cursor, oldest first', () => {
  const runs = [
    { id: 1, status: 'completed', updated_at: '2026-07-05T10:00:00Z' },
    { id: 2, status: 'in_progress', updated_at: '2026-07-05T13:00:00Z' },
    { id: 3, status: 'completed', updated_at: '2026-07-05T12:00:00Z' },
  ];
  const fresh = selectNewCompletedRuns(runs, '2026-07-05T09:00:00Z');
  assert.deepEqual(fresh.map((r) => r.id), [1, 3]);
});

test('latestTimestamp returns the newest value or the fallback', () => {
  assert.equal(latestTimestamp([{ t: 'b' }, { t: 'd' }, { t: 'a' }], 't', 'c'), 'd');
  assert.equal(latestTimestamp([], 't', 'c'), 'c');
});

test('format helpers escape HTML and build a digest', () => {
  const prLine = formatPrMergedLine('o/r', { number: 9, title: '<script>', user: { login: 'a&b' } });
  assert.match(prLine, /Merged o\/r #9 &lt;script&gt; by a&amp;b/);
  const buildLine = formatBuildLine('o/r', { name: 'CI', conclusion: 'failure', head_branch: 'main' });
  assert.match(buildLine, /🔴 Build failure o\/r · CI \(main\)/);
  const digest = buildDigestMessage([prLine, buildLine]);
  assert.match(digest, /Nock Terminal — GitHub/);
  assert.equal(buildDigestMessage([]), '');
});

// ---- poller integration (fakes) ----

function makeHarness(overrides = {}) {
  const config = new Map(Object.entries({
    githubToken: 'tok',
    githubWatchRepos: ['owner/repo'],
    telegramNotifyPrMerged: true,
    telegramNotifyBuildComplete: true,
    ...(overrides.config || {}),
  }));
  const settingsStore = { get: (k) => config.get(k), set: (k, v) => config.set(k, v) };

  const stateBacking = new Map();
  const stateStore = { get: (k) => stateBacking.get(k), set: (k, v) => stateBacking.set(k, v) };

  const sends = [];
  const notifier = {
    isEnabled: () => overrides.enabled !== false,
    isQuietHours: () => overrides.quiet === true,
    send: async (text) => { sends.push(text); return { success: true }; },
  };

  const fetchCalls = [];
  const responses = overrides.responses || (() => ({}));
  const fetchJson = async (path, token) => {
    fetchCalls.push({ path, token });
    const r = responses(path);
    if (r instanceof Error) throw r;
    return r;
  };

  const poller = new GitHubNotifier({
    settingsStore, stateStore, notifier, fetchJson,
    now: () => overrides.now || 1000,
  });
  return { poller, sends, fetchCalls, stateBacking, config };
}

const RESP = (path) => {
  if (path.includes('/pulls')) {
    return [
      { number: 12, title: 'Fix bug', merged_at: '2026-07-05T10:00:00Z', user: { login: 'kev' } },
      { number: 11, title: 'ancient', merged_at: '1970-01-01T00:00:00Z' },
    ];
  }
  if (path.includes('/actions/runs')) {
    return { workflow_runs: [
      { id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main', updated_at: '2026-07-05T10:05:00Z' },
    ] };
  }
  return {};
};

test('first poll baselines a new repo without fetching or notifying', async () => {
  const h = makeHarness({ responses: RESP });
  await h.poller._pollOnce();
  assert.equal(h.fetchCalls.length, 0, 'no fetch on baseline');
  assert.equal(h.sends.length, 0, 'no notification on baseline');
  const state = h.stateBacking.get('githubPollState')['owner/repo'];
  assert.ok(state.prsSince && state.runsSince, 'baseline cursors set');
});

test('second poll notifies new merged PRs and completed runs, then dedupes', async () => {
  const h = makeHarness({ responses: RESP });
  await h.poller._pollOnce(); // baseline (cursor ~1970 from now=1000)
  await h.poller._pollOnce(); // real poll

  assert.equal(h.sends.length, 1, 'one digest sent');
  assert.match(h.sends[0], /Merged owner\/repo #12 Fix bug by kev/);
  assert.match(h.sends[0], /🟢 Build success owner\/repo · CI \(main\)/);
  assert.doesNotMatch(h.sends[0], /ancient/, 'pre-cursor PR excluded');

  const state = h.stateBacking.get('githubPollState')['owner/repo'];
  assert.equal(state.prsSince, '2026-07-05T10:00:00Z');
  assert.equal(state.runsSince, '2026-07-05T10:05:00Z');

  await h.poller._pollOnce(); // nothing new
  assert.equal(h.sends.length, 1, 'no duplicate notification');
});

test('is inactive without a token, without repos, or when telegram is disabled', async () => {
  for (const cfg of [{ githubToken: '' }, { githubWatchRepos: [] }]) {
    const h = makeHarness({ responses: RESP, config: cfg });
    await h.poller._pollOnce();
    assert.equal(h.fetchCalls.length, 0);
    assert.equal(h.sends.length, 0);
  }
  const disabled = makeHarness({ responses: RESP, enabled: false });
  await disabled.poller._pollOnce();
  assert.equal(disabled.sends.length, 0);
});

test('quiet hours skip the cycle without advancing baselines', async () => {
  const h = makeHarness({ responses: RESP, quiet: true });
  await h.poller._pollOnce();
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.sends.length, 0);
  assert.equal(h.stateBacking.get('githubPollState'), undefined, 'no baseline written during quiet hours');
});

test('build toggle off skips the actions/runs fetch', async () => {
  const h = makeHarness({ responses: RESP, config: { telegramNotifyBuildComplete: false } });
  // seed baseline so the second poll fetches
  h.stateBacking.set('githubPollState', { 'owner/repo': { prsSince: '2026-07-05T09:00:00Z', runsSince: '2026-07-05T09:00:00Z' } });
  await h.poller._pollOnce();
  assert.ok(h.fetchCalls.some((c) => c.path.includes('/pulls')));
  assert.ok(!h.fetchCalls.some((c) => c.path.includes('/actions/runs')), 'no build fetch when toggle off');
});

test('a failing repo fetch is isolated and does not advance its cursor', async () => {
  const boom = (path) => (path.includes('/pulls') ? new Error('GitHub API 503') : { workflow_runs: [] });
  const h = makeHarness({ responses: boom });
  h.stateBacking.set('githubPollState', { 'owner/repo': { prsSince: '2026-07-05T09:00:00Z', runsSince: '2026-07-05T09:00:00Z' } });
  await h.poller._pollOnce();
  assert.equal(h.sends.length, 0);
  // cursor untouched so we retry next cycle
  assert.equal(h.stateBacking.get('githubPollState')['owner/repo'].prsSince, '2026-07-05T09:00:00Z');
});

test('overlap guard prevents concurrent polls', async () => {
  const h = makeHarness({ responses: RESP });
  h.poller.polling = true;
  await h.poller._pollOnce();
  assert.equal(h.fetchCalls.length, 0, 'skips while a poll is in flight');
});
