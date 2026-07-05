const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const NockCCClient = require('../electron/nockcc-client');

async function withHttpServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function createClient(baseUrl) {
  return new NockCCClient({
    get(key) {
      if (key === 'nockccApiKey') return 'test-key';
      if (key === 'nockccUrl') return baseUrl;
      return '';
    },
  });
}

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

test('_request sends canonical X-API-Key header casing', async () => {
  await withHttpServer((req, res) => {
    req.resume();
    assert.ok(req.rawHeaders.includes('X-API-Key'));
    res.writeHead(204);
    res.end();
  }, async (baseUrl) => {
    const client = createClient(baseUrl);
    await client._request('PATCH', '/api/test/', {});
  });
});

test('_request refuses to send the API key over cleartext http to a non-loopback host', async () => {
  const https = require('https');
  const origHttp = http.request;
  const origHttps = https.request;
  let attempted = 0;
  const trap = () => { attempted += 1; throw new Error('request must not be attempted'); };
  http.request = trap;
  https.request = trap;
  try {
    // A 127.x-prefixed spoof host must be treated as remote, not loopback.
    for (const baseUrl of ['http://127.0.0.1.evil.com', 'http://198.51.100.10']) {
      const client = createClient(baseUrl);
      await client._request('POST', '/api/test/', {});
      client.startSession({ machine: 'test' });
    }
    assert.equal(attempted, 0, 'no request should be attempted over cleartext to a remote host');
  } finally {
    http.request = origHttp;
    https.request = origHttps;
  }
});

test('_request rejects oversized NockCC responses', async () => {
  await withHttpServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('x'.repeat((1024 * 1024) + 1));
  }, async (baseUrl) => {
    const client = createClient(baseUrl);
    await assert.rejects(
      client._request('PATCH', '/api/test/', {}),
      /NockCC response exceeded 1 MB/
    );
  });
});
