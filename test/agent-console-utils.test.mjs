import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentInventory, buildResidentDraft, normalizeManagedAgent,
  parseWorkspaceRoots, unwrapManagedResponse, validateResidentDraft,
} from '../src/utils/agentConsole.mjs';

test('normalizes the managed resident service contract without inventing capabilities', () => {
  const agent = normalizeManagedAgent({
    id: 'managed:mira',
    agentId: 'mira',
    displayName: 'Mira',
    status: 'needs_auth',
    agent: {
      name: 'mira',
      model: 'claude-opus-4-8[1m]',
      permissionPreset: 'standard',
      workingDirectory: '/Users/kevin/Dev/mira',
      permissions: { allowedRoots: ['/Users/kevin/Dev/mira'] },
    },
    metadata: {
      template: 'claude-code-tmux-resident',
      identity: { role: 'Resident operator', partner: 'Kevin' },
      workspaces: { allowedRoots: ['/Users/kevin/Dev/mira'], deniedRoots: [] },
    },
    capabilities: { authenticate: true, start: false },
  });

  assert.equal(agent.id, 'mira');
  assert.equal(agent.permission.defaultMode, 'acceptEdits');
  assert.equal(agent.capabilities.authenticate, true);
  assert.equal(agent.capabilities.start, false);
  assert.equal(agent.capabilities.edit, false);
  assert.deepEqual(agent.allowedRoots, ['/Users/kevin/Dev/mira']);
});

test('managed inventory deduplicates rows and sorts by display name', () => {
  const inventory = buildAgentInventory([
    { id: 'managed:mira', agentId: 'mira', displayName: 'Mira', status: 'stopped', agent: { name: 'mira' } },
    { id: 'managed:ash', agentId: 'ash', displayName: 'Ash', status: 'stopped', agent: { name: 'ash' } },
    { id: 'managed:mira', agentId: 'mira', displayName: 'Mira duplicate', status: 'stopped', agent: { name: 'mira' } },
  ]);

  assert.deepEqual(inventory.map((agent) => agent.id), ['ash', 'mira']);
});

test('builds resident drafts with normalized roots and validates identity', () => {
  const draft = buildResidentDraft({
    id: 'Mira-01', displayName: 'Mira', purpose: 'Own resident operations',
    allowedRoots: '/Users/kevin/Dev/mira\n/Users/kevin/Dev/shared', deniedRoots: '/Users/kevin/.ssh',
  });
  assert.deepEqual(draft.allowedRoots, ['/Users/kevin/Dev/mira', '/Users/kevin/Dev/shared']);
  assert.equal(draft.id, 'mira-01');
  assert.equal(draft.model, 'claude-opus-4-8[1m]');
  assert.deepEqual(parseWorkspaceRoots('/a, /b\n/c'), ['/a', '/b', '/c']);
  assert.equal(validateResidentDraft({ id: 'Mira!', displayName: 'Mira', purpose: 'test' }).valid, false);
  assert.equal(validateResidentDraft({ id: 'mira', displayName: 'Mira', role: 'Operator', purpose: 'test' }).valid, true);
  assert.equal(validateResidentDraft({ id: 'mira', displayName: 'Mira', role: 'Operator', purpose: 'test', allowedRoots: 'relative' }).valid, false);
});

test('unwraps successful IPC envelopes and rejects typed failures', () => {
  assert.deepEqual(unwrapManagedResponse({ success: true, data: { agents: [1] } }, 'agents'), [1]);
  assert.throws(() => unwrapManagedResponse({ success: false, error: 'Seat is live' }), /Seat is live/);
});
