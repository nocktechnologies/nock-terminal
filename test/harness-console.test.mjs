import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
