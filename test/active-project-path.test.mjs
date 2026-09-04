import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveActiveProjectPath } from '../src/utils/activeProjectPath.mjs';

test('resolveActiveProjectPath uses the active tab cwd first', () => {
  const activeTab = { cwd: '/Users/kevin/Dev/nock-terminal' };
  const sessions = [
    { id: 'dev:/Users/kevin/Dev/nock-terminal', path: '/Users/kevin/Dev/nock-terminal', branch: 'main' },
  ];

  assert.equal(resolveActiveProjectPath(activeTab, sessions), '/Users/kevin/Dev/nock-terminal');
});

test('resolveActiveProjectPath ignores active tab cwd when it is only a broad transcript root', () => {
  const activeTab = { cwd: '/Users/kevin/Dev' };
  const sessions = [
    {
      id: '-Users-kevin-Dev',
      name: 'Dev',
      path: '/Users/kevin/Dev',
      branch: null,
      sessionContract: {
        transcriptDiscovery: { source: 'claude-jsonl-cwd' },
      },
    },
    {
      id: 'dev:/Users/kevin/Dev/nock-terminal',
      name: 'nock-terminal',
      path: '/Users/kevin/Dev/nock-terminal',
      branch: 'main',
    },
  ];

  assert.equal(resolveActiveProjectPath(activeTab, sessions), '/Users/kevin/Dev/nock-terminal');
});

test('resolveActiveProjectPath skips transcript-only broad roots for fallback', () => {
  const sessions = [
    {
      id: '-Users-kevin-Dev',
      name: 'Dev',
      path: '/Users/kevin/Dev',
      branch: null,
      sessionContract: {
        transcriptDiscovery: { source: 'claude-jsonl-cwd' },
      },
    },
    {
      id: 'dev:/Users/kevin/Dev/nock-terminal',
      name: 'nock-terminal',
      path: '/Users/kevin/Dev/nock-terminal',
      branch: 'main',
    },
  ];

  assert.equal(resolveActiveProjectPath(null, sessions), '/Users/kevin/Dev/nock-terminal');
});

test('resolveActiveProjectPath returns null when no project-like fallback exists', () => {
  const sessions = [
    { id: '-Users-kevin-Dev', name: 'Dev', path: '/Users/kevin/Dev', branch: null },
    { id: 'agent:/Users/kevin/Dev/claude-remote-manager/agents/mira', kind: 'agent', path: '/Users/kevin/Dev/claude-remote-manager/agents/mira' },
  ];

  assert.equal(resolveActiveProjectPath(null, sessions), null);
});
