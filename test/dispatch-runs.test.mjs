import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISPATCH_RUN_STORAGE_KEY,
  MAX_DISPATCH_RUNS,
  canTransitionDispatchStatus,
  createDispatchRun,
  isTerminalDispatchStatus,
  normalizeDispatchRun,
  normalizeDispatchRunList,
  normalizeDispatchStatus,
  readDispatchRunsFromStorage,
  serializeDispatchRuns,
  writeDispatchRunsToStorage,
} from '../src/utils/dispatchRuns.mjs';

function createStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set(DISPATCH_RUN_STORAGE_KEY, initialValue);
  }
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('normalizes dispatch statuses and identifies terminal states', () => {
  assert.equal(normalizeDispatchStatus(' RUNNING '), 'running');
  assert.equal(normalizeDispatchStatus('not-a-status'), 'unknown');
  assert.equal(isTerminalDispatchStatus('completed'), true);
  assert.equal(isTerminalDispatchStatus('failed'), true);
  assert.equal(isTerminalDispatchStatus('running'), false);
});

test('allows asynchronous dispatch status transitions from the H3 contract', () => {
  assert.equal(canTransitionDispatchStatus('sent', 'accepted'), true);
  assert.equal(canTransitionDispatchStatus('sent', 'running'), true);
  assert.equal(canTransitionDispatchStatus('sent', 'completed'), true);
  assert.equal(canTransitionDispatchStatus('launched', 'accepted'), true);
  assert.equal(canTransitionDispatchStatus('accepted', 'blocked'), true);
  assert.equal(canTransitionDispatchStatus('running', 'blocked'), false);
  assert.equal(canTransitionDispatchStatus('running', 'failed'), true);
  assert.equal(canTransitionDispatchStatus('completed', 'running'), false);
});

test('normalizes dispatch runs without retaining task text', () => {
  assert.deepEqual(normalizeDispatchRun({
    id: 'run-1',
    createdAt: 100,
    updatedAt: 200,
    status: 'sent',
    agentName: 'ash',
    agentDisplayName: 'Ash',
    runtime: 'codex',
    targetRepo: '/repo',
    projectName: 'nock-terminal',
    mode: 'brokered',
    requestId: 'request-1',
    messageId: '1500',
    broker: 'mira-nockos',
    taskDescription: 'do not persist this',
  }), {
    id: 'run-1',
    createdAt: 100,
    status: 'sent',
    updatedAt: 200,
    agentName: 'ash',
    agentDisplayName: 'Ash',
    runtime: 'codex',
    targetRepo: '/repo',
    projectName: 'nock-terminal',
    mode: 'brokered',
    requestId: 'request-1',
    messageId: '1500',
    broker: 'mira-nockos',
  });
});

test('creates new dispatch runs with caller-provided ids and timestamps', () => {
  assert.deepEqual(createDispatchRun({
    id: 'payload-id',
    createdAt: 999,
    status: 'launched',
    agentName: 'smith',
    command: 'dispatch',
  }, { id: 'dispatch-1', now: 123 }), {
    id: 'dispatch-1',
    createdAt: 123,
    status: 'launched',
    agentName: 'smith',
    command: 'dispatch',
  });
});

test('normalizes and caps persisted dispatch run history', () => {
  const runs = Array.from({ length: 20 }, (_, index) => ({
    createdAt: index + 1,
    status: index % 2 === 0 ? 'sent' : 'mystery',
    requestId: `request-${index}`,
  }));

  const normalized = normalizeDispatchRunList(runs, { now: 999 });

  assert.equal(normalized.length, MAX_DISPATCH_RUNS);
  assert.equal(normalized[0].id, 'dispatch-request-0');
  assert.equal(normalized[1].status, 'unknown');
});

test('reads and writes dispatch runs from storage defensively', () => {
  const storage = createStorage();
  writeDispatchRunsToStorage(storage, [
    { id: 'keep', createdAt: 100, status: 'failed', error: 'Nope', taskDescription: 'drop me' },
  ]);

  assert.equal(storage.getItem(DISPATCH_RUN_STORAGE_KEY), JSON.stringify([
    { id: 'keep', createdAt: 100, status: 'failed', error: 'Nope' },
  ]));
  assert.deepEqual(readDispatchRunsFromStorage(storage), [
    { id: 'keep', createdAt: 100, status: 'failed', error: 'Nope' },
  ]);
  assert.deepEqual(readDispatchRunsFromStorage(createStorage('{bad json')), []);
});

test('serializeDispatchRuns returns normalized JSON only', () => {
  assert.equal(serializeDispatchRuns([
    { id: 'one', createdAt: 1, status: 'completed', taskDescription: 'drop' },
  ]), '[{"id":"one","createdAt":1,"status":"completed"}]');
});
