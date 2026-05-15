const test = require('node:test');
const assert = require('node:assert/strict');

const NockCCClient = require('../electron/nockcc-client');

test('heartbeat sends real activity payload fields', () => {
  const client = new NockCCClient({ get: () => 'test' });
  const calls = [];
  client._sessionId = 42;
  client._request = (method, path, body) => calls.push({ method, path, body });

  client.heartbeat({
    activeProjectCount: 2,
    activeClaudeSessionIds: ['tab-1'],
    activeAgentSessionIds: ['claude:tab-1', 'codex:tab-2'],
  });

  assert.deepEqual(calls, [
    {
      method: 'PATCH',
      path: '/api/terminal/sessions/42/',
      body: {
        active_project_count: 2,
        active_claude_session_ids: ['tab-1'],
        active_agent_session_ids: ['claude:tab-1', 'codex:tab-2'],
      },
    },
  ]);
});
