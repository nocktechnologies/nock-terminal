import test from 'node:test';
import assert from 'node:assert/strict';

import {
  harnessAccessSurface,
  harnessAgentPulse,
  harnessControlState,
  harnessPresence,
  presenceDateTime,
  harnessQueueActions,
  findHarnessSeatCollision,
  isCurrentHarnessSeat,
  isHarnessLaunchPending,
  removeHarnessSeat,
  upsertHarnessSeat,
} from '../src/utils/harnessConsole.mjs';

const mira = {
  id: 'nock@nock-fleet-02:22/mira',
  label: 'Mira',
  agent: 'mira',
  host: 'nock-fleet-02',
  user: 'nock',
  port: 22,
  enginePath: '/home/nock/Dev/nock-agent-harness',
  transport: 'ssh',
};

test('upsertHarnessSeat replaces a matching connection without disturbing seat order', () => {
  const crane = { ...mira, id: 'kevin@mac:22/crane', label: 'Crane', agent: 'crane', host: 'mac', user: 'kevin' };
  const updated = upsertHarnessSeat([mira, crane], { ...mira, label: 'Mira — Fleet 02' });

  assert.deepEqual(updated.map((seat) => seat.label), ['Mira — Fleet 02', 'Crane']);
});

test('removeHarnessSeat removes only the requested connection', () => {
  const crane = { ...mira, id: 'kevin@mac:22/crane', label: 'Crane', agent: 'crane', host: 'mac', user: 'kevin' };

  assert.deepEqual(removeHarnessSeat([mira, crane], mira.id), [crane]);
});

test('findHarnessSeatCollision ignores the edited seat but protects another seat', () => {
  const crane = { ...mira, id: 'kevin@mac:22/crane', label: 'Crane', agent: 'crane', host: 'mac', user: 'kevin' };

  assert.equal(findHarnessSeatCollision([mira, crane], mira.id, mira.id), null);
  assert.equal(findHarnessSeatCollision([mira, crane], crane.id, mira.id), crane);
});

test('interactive harness modes stay embedded while an engine shell opens a terminal tab', () => {
  assert.equal(harnessAccessSurface('console'), 'embedded');
  assert.equal(harnessAccessSurface('watch'), 'embedded');
  assert.equal(harnessAccessSurface('shell'), 'terminal');
});

test('pending harness launches are scoped to their seat and optional mode', () => {
  const pending = { seatId: mira.id, mode: 'console' };

  assert.equal(isHarnessLaunchPending(pending, mira.id), true);
  assert.equal(isHarnessLaunchPending(pending, mira.id, 'console'), true);
  assert.equal(isHarnessLaunchPending(pending, mira.id, 'watch'), false);
  assert.equal(isHarnessLaunchPending(pending, 'kevin@mac:22/crane'), false);
  assert.equal(isHarnessLaunchPending(null, mira.id), false);
});

test('stale harness launch results do not belong to the newly selected seat', () => {
  assert.equal(isCurrentHarnessSeat(mira.id, mira.id), true);
  assert.equal(isCurrentHarnessSeat('kevin@mac:22/crane', mira.id), false);
});

test('control state stays unavailable until the engine publishes typed capabilities', () => {
  assert.deepEqual(harnessControlState(null), {
    available: false,
    seatState: 'unknown',
    paused: false,
    turnActive: false,
    steerable: false,
    canPause: false,
    canResume: false,
    canCancelTurn: false,
    canQueueRetry: false,
    canQueueAcknowledge: false,
  });

  assert.deepEqual(harnessControlState({
    control: {
      available: false,
      seatState: 'working:message',
      paused: true,
      turn: { active: true, steerable: true },
      capabilities: {
        pause: true,
        resume: true,
        cancelTurn: true,
        queueRetry: true,
        queueAcknowledge: true,
      },
    },
  }), {
    available: false,
    seatState: 'unknown',
    paused: false,
    turnActive: false,
    steerable: false,
    canPause: false,
    canResume: false,
    canCancelTurn: false,
    canQueueRetry: false,
    canQueueAcknowledge: false,
  });

  assert.deepEqual(harnessControlState({
    control: {
      available: true,
      seatState: 'working:message',
      paused: false,
      turn: { active: true, steerable: true },
      capabilities: { pause: true, resume: false, cancelTurn: true },
    },
  }), {
    available: true,
    seatState: 'working:message',
    paused: false,
    turnActive: true,
    steerable: true,
    canPause: true,
    canResume: false,
    canCancelTurn: true,
    canQueueRetry: false,
    canQueueAcknowledge: false,
  });
});

test('only dead wakes expose retry and acknowledge actions', () => {
  assert.deepEqual(harnessQueueActions({ state: 'dead' }, { queueRetry: true, queueAcknowledge: true }), {
    canRetry: true,
    canAcknowledge: true,
  });
  assert.deepEqual(harnessQueueActions({ state: 'working' }, { queueRetry: true, queueAcknowledge: true }), {
    canRetry: false,
    canAcknowledge: false,
  });
});

test('agent pulse stays unavailable until the engine publishes the v1 contract', () => {
  assert.deepEqual(harnessAgentPulse(null), {
    available: false,
    disposition: 'unknown',
    reasonCode: 'PULSE_UNAVAILABLE',
    reasonSummary: 'This engine has not published Agent Pulse yet.',
    objective: '',
    currentAction: null,
    nextAction: null,
    initiative: {
      state: 'unknown',
      reasonCode: '',
      attentionRequired: false,
      wakeId: null,
      nextJudgmentAt: null,
    },
    lastOutcome: null,
    updatedAt: null,
  });
});

test('agent pulse exposes the bounded engine-authored work chain without inference', () => {
  assert.deepEqual(harnessAgentPulse({
    control: {
      available: true,
      pulse: {
        schemaVersion: 1,
        updatedAt: 1785618000.25,
        disposition: 'working',
        reason: { code: 'TURN_ACTIVE', summary: 'Advance the operator console' },
        objective: 'Make owned work visible.',
        currentAction: { id: 'wake:886', source: 'telegram', title: 'Build pulse', startedAt: 1785617900 },
        nextAction: { id: 'plan:step:4', source: 'active_plan', title: 'Live verify', status: 'current' },
        initiative: { state: 'working', reasonCode: 'TURN_ACTIVE', attentionRequired: false, wakeId: 886, nextJudgmentAt: 1785625200 },
        lastOutcome: { verified: true, observedAt: 1785617600, transition: 'ACTED', summary: 'Published pulse.', evidence: ['test evidence'] },
      },
    },
  }), {
    available: true,
    disposition: 'working',
    reasonCode: 'TURN_ACTIVE',
    reasonSummary: 'Advance the operator console',
    objective: 'Make owned work visible.',
    currentAction: { id: 'wake:886', source: 'telegram', title: 'Build pulse', startedAt: 1785617900 },
    nextAction: { id: 'plan:step:4', source: 'active_plan', title: 'Live verify', status: 'current' },
    initiative: { state: 'working', reasonCode: 'TURN_ACTIVE', attentionRequired: false, wakeId: 886, nextJudgmentAt: 1785625200 },
    lastOutcome: { verified: true, observedAt: 1785617600, transition: 'ACTED', summary: 'Published pulse.', evidence: ['test evidence'] },
    updatedAt: 1785618000.25,
  });
});

test('presence exposes engine-published public activity without inferring thoughts', () => {
  const presence = harnessPresence({
    control: {
      available: true,
      presence: {
        schemaVersion: 1,
        events: [
          { id: 'event-1', at: 100, kind: 'turn_started', summary: 'Started the migration', wakeId: 9 },
          { id: 'event-2', at: 110, kind: 'progress', summary: 'I verified the new residence.', wakeId: 9 },
        ],
      },
    },
  });

  assert.equal(presence.available, true);
  assert.equal(presence.events.length, 2);
  assert.equal(presence.events.at(-1).summary, 'I verified the new residence.');
  assert.deepEqual(harnessPresence(null), { available: false, events: [] });
});

test('presence timestamps never throw for malformed runtime values', () => {
  assert.equal(presenceDateTime(1785618000.25), '2026-08-01T21:00:00.250Z');
  assert.equal(presenceDateTime(Number.NaN), undefined);
  assert.equal(presenceDateTime('1785618000'), undefined);
  assert.equal(presenceDateTime(undefined), undefined);
});
