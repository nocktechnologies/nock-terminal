#!/usr/bin/env python3
"""Capture sanitized Nock Terminal marketing screenshots from the Vite app.

Run `npm run dev` first, then:

    python3 scripts/capture-marketing-screenshots.py
"""

from pathlib import Path

from playwright.sync_api import expect, sync_playwright


OUTPUT_DIR = Path("docs/marketing/screenshots")
BASE_URL = "http://localhost:5173/"
VIEWPORT = {"width": 1440, "height": 900}

MOCK_BRIDGE = r"""
(() => {
  const now = Date.now();
  const root = '/work/repos/nock-terminal';
  const sessions = [
    { id: 'agent-mira', kind: 'agent', name: 'Mira', path: '/work/agents/mira', status: 'active', lastActivityFormatted: 'just now', agent: { name: 'mira', lifecycle: 'running', runtime: 'CRM', model: 'nockos broker', unreadCount: 12, inflightCount: 2, enabled: true }, launch: { mode: 'terminal', command: 'tmux attach -t crm-default-mira', cwd: '/work/agents/mira' } },
    { id: 'agent-smith', kind: 'agent', name: 'Smith', path: '/work/dispatch/deepseek/smith', status: 'active', lastActivityFormatted: '4 min ago', agent: { name: 'smith', lifecycle: 'dispatch', runtime: 'deepseek', model: 'deepseek-r1', unreadCount: 3, inflightCount: 1, enabled: true }, launch: { mode: 'dispatch', canLaunch: true, runtime: 'deepseek', broker: 'mira-nockos', aliasCommand: 'mira dispatch smith', cwd: '/work/dispatch', commandTemplate: 'mira dispatch smith --task <task>' } },
    { id: 'agent-talon', kind: 'agent', name: 'Talon', path: '/work/dispatch/codex/talon', status: 'recent', lastActivityFormatted: '12 min ago', agent: { name: 'talon', lifecycle: 'dispatch', runtime: 'codex', model: 'gpt-5.4', unreadCount: 0, inflightCount: 1, enabled: true }, launch: { mode: 'dispatch', canLaunch: true, runtime: 'codex', broker: 'mira-nockos', aliasCommand: 'mira dispatch talon', cwd: '/work/dispatch', commandTemplate: 'mira dispatch talon --task <task>' } },
    { id: 'agent-forge', kind: 'agent', name: 'Forge', path: '/work/dispatch/codex/forge', status: 'recent', lastActivityFormatted: '22 min ago', agent: { name: 'forge', lifecycle: 'dispatch', runtime: 'codex', model: 'gpt-5.4', unreadCount: 0, inflightCount: 0, enabled: true }, launch: { mode: 'dispatch', canLaunch: true, runtime: 'codex', broker: 'mira-nockos', aliasCommand: 'mira dispatch forge', cwd: '/work/dispatch', commandTemplate: 'mira dispatch forge --task <task>' } },
    { id: 'agent-beck', kind: 'agent', name: 'Beck', path: '/work/agents/beck', status: 'inactive', lastActivityFormatted: '1h ago', agent: { name: 'beck', lifecycle: 'idle', runtime: 'CRM', model: 'persistent tmux', unreadCount: 0, inflightCount: 0, enabled: true }, launch: { mode: 'terminal', command: 'tmux attach -t crm-default-beck', cwd: '/work/agents/beck' } },
    { id: 'agent-wren', kind: 'agent', name: 'Wren', path: '/work/agents/wren', status: 'inactive', lastActivityFormatted: '2h ago', agent: { name: 'wren', lifecycle: 'stale', runtime: 'CRM', model: 'persistent tmux', unreadCount: 0, inflightCount: 0, enabled: true }, launch: { mode: 'terminal', command: 'tmux attach -t crm-default-wren', cwd: '/work/agents/wren' } },
    { id: 'agent-iris', kind: 'agent', name: 'Iris', path: '/work/agents/iris', status: 'inactive', lastActivityFormatted: '3h ago', agent: { name: 'iris', lifecycle: 'idle', runtime: 'CRM', model: 'persistent tmux', unreadCount: 0, inflightCount: 0, enabled: true }, launch: { mode: 'terminal', command: 'tmux attach -t crm-default-iris', cwd: '/work/agents/iris' } },
    { id: 'repo-nock-terminal', kind: 'repo', name: 'nock-terminal', path: root, status: 'active', branch: 'main', dirty: false, lastActivityFormatted: 'just now' },
    { id: 'repo-command-center', kind: 'repo', name: 'nock-command-center', path: '/work/repos/nock-command-center', status: 'recent', branch: 'feature/fleet-inbox', dirty: true, lastActivityFormatted: '18 min ago' },
    { id: 'repo-foundry', kind: 'repo', name: 'foundry-web', path: '/work/repos/foundry-web', status: 'recent', branch: 'feature/voice-landing-page', dirty: true, lastActivityFormatted: '42 min ago' },
    { id: 'repo-launch-lab', kind: 'repo', name: 'launch-lab', path: '/work/repos/launch-lab', status: 'inactive', branch: 'main', dirty: false, lastActivityFormatted: '1d ago' },
    { id: 'repo-atlas-kit', kind: 'repo', name: 'atlas-kit', path: '/work/repos/atlas-kit', status: 'inactive', branch: 'agent/codex-audit', dirty: false, lastActivityFormatted: '2d ago' },
    { id: 'repo-nock-fit', kind: 'repo', name: 'nock-fit', path: '/work/repos/nock-fit', status: 'inactive', branch: 'main', dirty: false, lastActivityFormatted: '3d ago' },
  ];

  const profiles = {
    '/work/repos/nock-terminal': { defaultAgent: 'codex' },
    '/work/repos/nock-command-center': { defaultAgent: 'claude' },
    '/work/repos/foundry-web': { defaultAgent: 'gemini' },
    '/work/repos/launch-lab': { defaultAgent: 'codex' },
    '/work/repos/atlas-kit': { defaultAgent: 'codex' },
    '/work/repos/nock-fit': { defaultAgent: 'claude' },
  };

  const dataHandlers = new Set();
  const exitHandlers = new Set();
  const processHandlers = new Set();
  const createdTerminalIds = new Set();
  const handledTerminalCommands = new Set();
  const emitData = (id, data) => dataHandlers.forEach((callback) => callback(id, data));
  const emitStatus = (id, agents = []) => processHandlers.forEach((callback) => callback({ tabId: id, activeAgents: agents, hasClaude: agents.includes('claude') }));
  const basename = (path) => String(path || 'workspace').split('/').filter(Boolean).pop() || 'workspace';
  const terminalIntro = (cwd) => `\x1b[38;5;87mNOCK TERMINAL\x1b[0m  local agent cockpit\r\n\x1b[90mworkspace\x1b[0m  ${cwd}\r\n\x1b[37mkevin@nock ${basename(cwd)} % \x1b[0m`;
  const commandOutput = (command) => (
    /mira/.test(command)
      ? `${command}\r\n\x1b[38;5;80mattached\x1b[0m crm-default-mira · Mira session ready\r\n\x1b[90mcontext\x1b[0m AGENTS.md ✓  CLAUDE.md ✓  .nock/config.toml ✓\r\n\x1b[37mmira@nock crm-default-mira % \x1b[0m`
      : `${command}\r\n\x1b[38;5;80magent launched\x1b[0m task staged, waiting for submit\r\n`
  );

  localStorage.setItem('nock-terminal.dispatchRuns.v1', JSON.stringify([
    { id: 'run-1', createdAt: now - 120000, agentName: 'smith', agentDisplayName: 'Smith', runtime: 'deepseek', mode: 'brokered', status: 'sent' },
    { id: 'run-2', createdAt: now - 900000, agentName: 'talon', agentDisplayName: 'Talon', runtime: 'codex', mode: 'direct', status: 'launched' },
  ]));

  window.nockTerminal = {
    sessions: { discover: async () => sessions },
    ports: { scan: async () => [
      { port: 5173, url: '#', processName: 'vite', label: 'renderer dev' },
      { port: 8012, url: '#', processName: 'django', label: 'nockcc api' },
    ] },
    profiles: { get: async (path) => profiles[path] || {} },
    ai: {
      onStream: () => () => {},
      ollama: {
        status: async () => ({ connected: true }),
        models: async () => [{ name: 'qwen2.5-coder:14b', size: 9e9 }, { name: 'llama3.1:8b', size: 4.7e9 }],
        chat: async () => true,
      },
    },
    process: { onStatus: (callback) => { processHandlers.add(callback); return () => processHandlers.delete(callback); } },
    terminal: {
      create: async ({ id, cwd }) => {
        if (!createdTerminalIds.has(id)) {
          createdTerminalIds.add(id);
          setTimeout(() => emitData(id, terminalIntro(cwd)), 120);
          setTimeout(() => emitStatus(id, basename(cwd).includes('mira') ? ['mira'] : []), 160);
        }
        return { success: true };
      },
      write: (id, data) => {
        const text = String(data || '');
        if (text.includes('\r')) {
          const command = text.replace(/[\r\n]+/g, '').trim();
          const commandKey = `${id}:${command}`;
          if (!command || handledTerminalCommands.has(commandKey)) return;
          handledTerminalCommands.add(commandKey);
          setTimeout(() => emitData(id, commandOutput(command)), 120);
          setTimeout(() => emitStatus(id, ['mira']), 160);
        }
      },
      resize: () => {},
      destroy: () => {},
      onData: (callback) => { dataHandlers.add(callback); return () => dataHandlers.delete(callback); },
      onExit: (callback) => { exitHandlers.add(callback); return () => exitHandlers.delete(callback); },
    },
    files: {
      tree: async () => [
        { type: 'dir', name: 'src', path: `${root}/src`, children: [
          { type: 'dir', name: 'components', path: `${root}/src/components`, children: [
            { type: 'file', name: 'Dashboard.jsx', path: `${root}/src/components/Dashboard.jsx` },
            { type: 'file', name: 'CommandPalette.jsx', path: `${root}/src/components/CommandPalette.jsx` },
          ] },
          { type: 'file', name: 'App.jsx', path: `${root}/src/App.jsx` },
        ] },
        { type: 'dir', name: 'docs', path: `${root}/docs`, children: [
          { type: 'file', name: 'ROADMAP.md', path: `${root}/docs/ROADMAP.md` },
          { type: 'file', name: 'AGENT_DISPATCH.md', path: `${root}/docs/AGENT_DISPATCH.md` },
        ] },
        { type: 'file', name: 'AGENTS.md', path: `${root}/AGENTS.md` },
        { type: 'file', name: 'CLAUDE.md', path: `${root}/CLAUDE.md` },
      ],
      watch: () => {},
      stopWatch: () => {},
      onChanged: () => () => {},
      onGitStatus: (callback) => { setTimeout(() => callback({ 'src/components/Dashboard.jsx': 'M', 'docs/ROADMAP.md': 'M' }), 80); return () => {}; },
      read: async () => ({ content: '# sanitized marketing capture' }),
      stat: async (path) => {
        const exists = /CLAUDE\.md|AGENTS\.md|\.codex\/config\.toml|\.nock\/config\.toml/.test(String(path));
        return { exists, size: exists ? 4200 : 0, mtime: exists ? now - 18 * 60 * 1000 : 0, path };
      },
    },
    sessionHistory: {
      start: () => {},
      list: async () => [{ tabId: 'hist-1', project: 'Mira', startTime: now - 35 * 60 * 1000, endTime: now - 20 * 60 * 1000, hasOutput: true, exitCode: 0 }],
      getOutput: async () => 'sanitized terminal output',
    },
    prompts: {
      list: async () => [{ id: 'p1', title: 'Audit repo context', tags: ['audit', 'context'] }],
      get: async (id) => ({ id, title: 'Audit repo context', tags: ['ops'], body: 'Review the repo state.' }),
      save: async (id) => ({ success: true, id: id || 'p-new' }),
      delete: async () => ({ success: true }),
    },
    settings: {
      getAll: async () => ({
        terminalFontSize: 16,
        terminalFontFamily: 'JetBrains Mono, Menlo, monospace',
        cursorStyle: 'block',
        cursorBlink: true,
        scrollbackSize: 5000,
        defaultShell: '/bin/zsh',
        devRoots: ['/work/repos', '/work/agents'],
        projectSkipList: ['node_modules'],
        nockccUrl: 'https://cc.nocktechnologies.io',
      }),
      get: async () => '',
      set: async () => true,
      getSecure: async () => '',
    },
    system: { appVersion: async () => '1.0.0', ollamaVersion: async () => '0.7.1', detectShells: async () => ['/bin/zsh'] },
    dispatch: {
      brokered: async () => ({ requestId: 'req', messageId: 'msg' }),
      createPayload: async () => ({ command: 'mira dispatch smith --payload task.json', request: { requestId: 'req' } }),
    },
    nockcc: { updateActivity: () => {} },
    shell: { openExternal: () => {}, showItemInFolder: () => {} },
    clipboard: { read: async () => '', write: () => {} },
    window: { minimize: () => {}, maximize: () => {}, close: () => {}, isMaximized: async () => false },
  };
})();
"""


def prepare(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    expect(page.get_by_text("Fleet Overview")).to_be_visible(timeout=10_000)
    page.wait_for_timeout(700)


def screenshot(page, filename):
    page.wait_for_timeout(900)
    page.screenshot(path=str(OUTPUT_DIR / filename), full_page=False, animations="disabled")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
        page.add_init_script(MOCK_BRIDGE)

        prepare(page)
        screenshot(page, "01-dashboard-fleet-overview.png")

        page.get_by_label("Search repos and agents").nth(1).fill("smith")
        screenshot(page, "02-repo-agent-search.png")

        prepare(page)
        page.keyboard.press("Meta+K")
        expect(page.locator('[role="dialog"]')).to_be_visible(timeout=5_000)
        page.locator('[role="dialog"] input[aria-label="Find repos, agents, branches, and commands"]').fill("smith")
        page.locator('[role="dialog"] textarea').fill(
            "Investigate the failing release check, patch the smallest fix, run the focused tests, and report the PR-ready summary."
        )
        screenshot(page, "03-command-launcher-task-staging.png")

        prepare(page)
        page.evaluate(
            """() => {
              const card = [...document.querySelectorAll('button')]
                .find((button) => button.innerText.includes('cmd: tmux attach -t crm-default-mira'));
              if (!card) throw new Error('Mira dashboard card not found');
              card.click();
            }"""
        )
        page.wait_for_timeout(2500)
        screenshot(page, "04-agent-terminal-launch.png")

        prepare(page)
        page.keyboard.press("Meta+K")
        expect(page.locator('[role="dialog"]')).to_be_visible(timeout=5_000)
        page.locator('[role="dialog"] input[aria-label="Find repos, agents, branches, and commands"]').fill("nock-terminal")
        page.locator('[role="dialog"] select').nth(0).select_option("repo-nock-terminal")
        page.locator('[role="dialog"] select').nth(1).select_option("codex")
        page.locator('[role="dialog"] textarea').fill(
            "Open a clean Codex session in nock-terminal and inspect the replay lane spec against the current roadmap."
        )
        screenshot(page, "05-agent-agnostic-launch-profile.png")

        browser.close()

    for path in sorted(OUTPUT_DIR.glob("*.png")):
        print(path)


if __name__ == "__main__":
    main()
