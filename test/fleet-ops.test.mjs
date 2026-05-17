import test from 'node:test';
import assert from 'node:assert/strict';

import { orderTaskTargets, summarizeFleet } from '../src/utils/fleetOps.mjs';

test('summarizes agent, repo, terminal, and quiet-tab state', () => {
  const now = Date.now();
  const summary = summarizeFleet({
    now,
    sessions: [
      { kind: 'agent', agent: { lifecycle: 'idle' } },
      { kind: 'agent', agent: { lifecycle: 'stale' } },
      { kind: 'agent', agent: { lifecycle: 'dispatch' }, launch: { mode: 'dispatch', canLaunch: true } },
      { kind: 'project', dirty: true },
      { kind: 'project', dirty: false },
    ],
    tabs: [
      { id: 'tab-1', launchCommand: 'codex' },
      { id: 'tab-2' },
    ],
    processStatus: {
      'tab-1': { activeAgents: ['codex'], hasClaude: false },
      'tab-2': { activeAgents: [], hasClaude: true },
    },
    lastDataTimestamps: {
      'tab-1': now - 6 * 60 * 1000,
      'tab-2': now - 30 * 1000,
    },
  });

  assert.equal(summary.agents, 3);
  assert.equal(summary.repos, 2);
  assert.equal(summary.activeAgentFolders, 1);
  assert.equal(summary.staleAgentFolders, 1);
  assert.equal(summary.dispatchReadyAgents, 1);
  assert.equal(summary.dirtyRepos, 1);
  assert.equal(summary.terminals, 2);
  assert.equal(summary.activeAgentProcesses, 2);
  assert.equal(summary.quietAgentTabs, 1);
});

test('orders task targets by active path, agent folders, status, then name', () => {
  const ordered = orderTaskTargets([
    { name: 'zeta', path: '/zeta', kind: 'project', status: 'inactive' },
    { name: 'mira', path: '/agents/mira', kind: 'agent', status: 'active' },
    { name: 'alpha', path: '/alpha', kind: 'project', status: 'recent' },
  ], '/alpha');

  assert.deepEqual(ordered.map((session) => session.name), ['alpha', 'mira', 'zeta']);
});
