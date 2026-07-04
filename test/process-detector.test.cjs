const test = require('node:test');
const assert = require('node:assert/strict');

const ProcessDetector = require('../electron/process-detector');
const { parseUnixProcessTable } = ProcessDetector;

function makeDetector() {
  // _agentsInTree does not touch the terminalManager; a stub is enough.
  return new ProcessDetector({ terminals: new Map() });
}

// --- parseUnixProcessTable --------------------------------------------------

test('parseUnixProcessTable parses pid/ppid/full-command rows', () => {
  // Mimics `ps -axo pid=,ppid=,command=` output: right-aligned numeric cols,
  // command keeps its spaces.
  const output = [
    '  100     1 /bin/zsh -l',
    '  300   100 node /usr/local/bin/claude --resume abc',
    '  400   300 /usr/bin/python3 /home/u/deepseek-agent.py',
  ].join('\n');

  const rows = parseUnixProcessTable(output);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { pid: 100, ppid: 1, name: '/bin/zsh -l' });
  assert.deepEqual(rows[1], { pid: 300, ppid: 100, name: 'node /usr/local/bin/claude --resume abc' });
  assert.equal(rows[2].name, '/usr/bin/python3 /home/u/deepseek-agent.py');
});

test('parseUnixProcessTable skips blank and malformed lines', () => {
  const output = ['', '   ', 'garbage line', '  42    1 bash', 'PID PPID COMMAND'].join('\n');
  const rows = parseUnixProcessTable(output);
  assert.deepEqual(rows, [{ pid: 42, ppid: 1, name: 'bash' }]);
});

// --- _agentsInTree (the BFS the Unix path now shares with Windows) -----------

test('detects an agent nested at depth >= 2 (the pgrep -P regression)', () => {
  const d = makeDetector();
  // pty root (shell) -> login-shell wrapper -> claude. The old pgrep -P <root>
  // only saw the wrapper (depth 1) and missed claude entirely.
  const processes = [
    { pid: 100, ppid: 1, name: '/bin/zsh' },          // pty root
    { pid: 200, ppid: 100, name: '-zsh' },            // wrapper / login shell
    { pid: 300, ppid: 200, name: 'node /usr/local/bin/claude --resume' }, // depth 2
  ];
  const agents = d._agentsInTree(100, processes);
  assert.deepEqual(agents, ['claude']);
});

test('detects an agent that is a direct child (depth 1)', () => {
  const d = makeDetector();
  const processes = [
    { pid: 100, ppid: 1, name: '/bin/bash' },
    { pid: 250, ppid: 100, name: '/opt/homebrew/bin/codex' },
  ];
  assert.deepEqual(d._agentsInTree(100, processes), ['codex']);
});

test('a script-based agent matches via its full command line', () => {
  const d = makeDetector();
  const processes = [
    { pid: 100, ppid: 1, name: 'zsh' },
    { pid: 300, ppid: 100, name: '/usr/bin/python3 /home/u/deepseek-agent.py' },
  ];
  assert.deepEqual(d._agentsInTree(100, processes), ['deepseek']);
});

test('does not match an agent that lives outside the PTY subtree', () => {
  const d = makeDetector();
  const processes = [
    { pid: 100, ppid: 1, name: 'zsh' },               // our pty root
    { pid: 900, ppid: 1, name: 'claude' },            // unrelated sibling tree
  ];
  assert.deepEqual(d._agentsInTree(100, processes), []);
});

test('reports no agents for an empty/agentless subtree', () => {
  const d = makeDetector();
  const processes = [
    { pid: 100, ppid: 1, name: 'zsh' },
    { pid: 200, ppid: 100, name: 'vim' },
  ];
  assert.deepEqual(d._agentsInTree(100, processes), []);
});

test('a cyclic ppid graph terminates (visited guard)', () => {
  const d = makeDetector();
  // Pathological: 200 and 300 reference each other. Must not infinite-loop.
  const processes = [
    { pid: 200, ppid: 300, name: 'a' },
    { pid: 300, ppid: 200, name: 'b' },
    { pid: 400, ppid: 200, name: 'claude' },
  ];
  assert.deepEqual(d._agentsInTree(200, processes), ['claude']);
});

// --- event-loop safety: detection must never run synchronously ---------------

test('_detect emits status asynchronously, off the event loop', { skip: process.platform === 'win32' }, async () => {
  const detector = new ProcessDetector({
    terminals: new Map([['tab1', { pid: process.pid }]]),
  });
  const events = [];
  detector.on('status', (e) => events.push(e));

  detector._detect();
  // A synchronous (execSync-style) implementation has already emitted by now,
  // having blocked the event loop for the whole `ps` run.
  assert.equal(events.length, 0, 'status was emitted synchronously');

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no status emitted')), 6000);
    detector.once('status', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  assert.equal(events[0].tabId, 'tab1');
  assert.ok(Array.isArray(events[0].activeAgents));
  assert.equal(typeof events[0].hasClaude, 'boolean');
});
