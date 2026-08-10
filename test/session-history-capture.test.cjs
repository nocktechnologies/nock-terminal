const assert = require('node:assert/strict');
const test = require('node:test');

const SessionHistory = require('../electron/session-history');

test('does not redact or capture output for sessions started with capture disabled', () => {
  let captureEnabled = false;
  const history = new SessionHistory({ get: () => captureEnabled });

  history.startSession('disabled', {});
  const session = history.activeSessions.get('disabled');
  assert.equal(session.outputRedactor, null);

  captureEnabled = true;
  history.appendOutput('disabled', 'later output');
  assert.deepEqual(session.buffer, []);
});

test('stops parsing when capture is disabled or the session buffer is full', () => {
  let captureEnabled = true;
  const history = new SessionHistory({ get: () => captureEnabled });

  history.startSession('enabled', {});
  const session = history.activeSessions.get('enabled');
  session.outputRedactor.redact = () => {
    throw new Error('redactor should not run');
  };

  session.bufferSize = history.MAX_BUFFER_SIZE;
  history.appendOutput('enabled', 'full');

  session.bufferSize = 0;
  captureEnabled = false;
  history.appendOutput('enabled', 'disabled');
  assert.equal(session.outputRedactor, null);
});
