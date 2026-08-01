import test from 'node:test';
import assert from 'node:assert/strict';

import {
  harnessAccessSurface,
  harnessControlState,
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
