import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterSessionsBySearch,
  matchesSessionSearch,
  normalizeSessionSearchQuery,
} from '../src/utils/sessionSearch.mjs';

const sessions = [
  {
    name: 'Mira',
    path: '/Users/kevin/Dev/claude-remote-manager/agents/mira',
    kind: 'agent',
    status: 'active',
    branch: null,
    agent: {
      name: 'mira',
      lifecycle: 'idle',
      model: 'claude-opus-4-6',
    },
    launch: {
      command: 'mira',
      cwd: '/Users/kevin/Dev/claude-remote-manager/agents/mira',
    },
  },
  {
    name: 'forge-ops',
    path: '/Users/kevin/Dev/forge-ops',
    kind: 'project',
    status: 'inactive',
    branch: 'main',
  },
  {
    name: 'nock-command-center',
    path: '/Users/kevin/Dev/nock-command-center',
    kind: 'project',
    status: 'recent',
    branch: 'smith/nock-575-expand-manifest-rebased',
  },
];

test('normalizes repo search into lowercase terms', () => {
  assert.deepEqual(normalizeSessionSearchQuery('  Forge   MAIN  '), ['forge', 'main']);
});

test('matches sessions by name, path, branch, and agent metadata', () => {
  assert.equal(matchesSessionSearch(sessions[0], 'mira idle'), true);
  assert.equal(matchesSessionSearch(sessions[0], ['mira', 'idle']), true);
  assert.equal(matchesSessionSearch(sessions[1], 'forge main'), true);
  assert.equal(matchesSessionSearch(sessions[2], '575 manifest'), true);
  assert.equal(matchesSessionSearch(sessions[2], 'mira'), false);
});

test('filters sessions and preserves original order', () => {
  assert.deepEqual(
    filterSessionsBySearch(sessions, 'dev'),
    sessions
  );
  assert.deepEqual(filterSessionsBySearch(sessions, ''), sessions);
});
