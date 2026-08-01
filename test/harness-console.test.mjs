import test from 'node:test';
import assert from 'node:assert/strict';

import {
  harnessAccessSurface,
  findHarnessSeatCollision,
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
