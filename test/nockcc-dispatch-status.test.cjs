const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  AgentDispatchService,
  collectDispatchStatusUpdates,
} = require('../electron/agent-dispatch');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

test('collectDispatchStatusUpdates filters live AgentMessages by request id and status_update type', () => {
  const updates = collectDispatchStatusUpdates([
    {
      id: 1510,
      from_agent: 'mira-nockos',
      message_type: 'status_update',
      subject: 'Accepted',
      body: 'status: ignored because context wins',
      context: {
        request_id: 'req-1',
        status: 'accepted',
        status_message: 'Mira accepted the dispatch.',
      },
      created_at: '2026-05-24T16:00:00Z',
    },
    {
      id: 1511,
      sender_agent: 'ash',
      message_type: 'status_update',
      subject: 'Running',
      body: 'Dispatch is now running.',
      context: { request_id: 'req-2' },
      created_at: '2026-05-24T16:01:00Z',
    },
    {
      id: 1512,
      from_agent: 'ash',
      message_type: 'directive',
      body: 'completed',
      context: { request_id: 'req-1' },
    },
    {
      id: 1513,
      from_agent: 'ash',
      message_type: 'status_update',
      body: 'completed',
      context: { request_id: 'other-request' },
    },
  ], ['req-1', 'req-2']);

  assert.deepEqual(updates, [
    {
      messageId: '1510',
      requestId: 'req-1',
      status: 'accepted',
      statusMessage: 'Mira accepted the dispatch.',
      senderAgent: 'mira-nockos',
      subject: 'Accepted',
      createdAt: '2026-05-24T16:00:00Z',
      readAt: '',
      source: 'nockcc-live',
    },
    {
      messageId: '1511',
      requestId: 'req-2',
      status: 'running',
      statusMessage: 'Running',
      senderAgent: 'ash',
      subject: 'Running',
      createdAt: '2026-05-24T16:01:00Z',
      readAt: '',
      source: 'nockcc-live',
    },
  ]);
});

test('AgentDispatchService polls the nock-terminal inbox and returns correlated updates', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url,
      apiKey: req.headers['x-api-key'],
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: {
        messages: [
          {
            id: 2001,
            from_agent: 'mira-nockos',
            message_type: 'status_update',
            subject: 'Done',
            body: 'completed',
            context: { request_id: 'req-live' },
            created_at: '2026-05-24T16:02:00Z',
          },
        ],
      },
    }));
  });
  const address = await listen(server);

  try {
    const service = new AgentDispatchService({
      get(key) {
        if (key === 'nockccApiKey') return 'test-api-key';
        if (key === 'nockccUrl') return `http://127.0.0.1:${address.port}`;
        return '';
      },
    });

    const result = await service.pollStatusUpdates({
      requestIds: ['req-live'],
      agentName: 'nock-terminal',
      limit: 50,
    });

    assert.equal(result.success, true);
    assert.equal(result.agentName, 'nock-terminal');
    assert.equal(result.checkedMessageCount, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(result.updates[0].status, 'completed');
    assert.equal(requests[0].apiKey, 'test-api-key');
    assert.equal(requests[0].url, '/api/teams/messages/inbox/nock-terminal/?limit=50');
  } finally {
    server.close();
  }
});

test('collectDispatchStatusUpdates sorts same-time non-numeric message ids deterministically', () => {
  const updates = collectDispatchStatusUpdates([
    {
      id: 'status-b',
      from_agent: 'mira-nockos',
      message_type: 'status_update',
      body: 'running',
      context: { request_id: 'req-b' },
      created_at: '2026-05-24T16:00:00Z',
    },
    {
      id: 'status-a',
      from_agent: 'mira-nockos',
      message_type: 'status_update',
      body: 'accepted',
      context: { request_id: 'req-a' },
      created_at: '2026-05-24T16:00:00Z',
    },
  ], ['req-a', 'req-b']);

  assert.deepEqual(updates.map(update => update.messageId), ['status-a', 'status-b']);
});
