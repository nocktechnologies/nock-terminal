"""
Editor split layout smoke test.

Loads the Vite app with a mocked nockTerminal bridge, opens AGENTS.md from the
file tree, and verifies Monaco gets a real editor surface instead of collapsing
to a blank pane.

Requires dev server running: npm run dev
Usage: python3 test/editor-layout.smoke.py
"""
import sys
from playwright.sync_api import sync_playwright

APP_URL = 'http://localhost:5173'
TIMEOUT_MS = 30_000

NOCK_TERMINAL_MOCK = """
  window.nockTerminal = {
    sessions: {
      discover: () => Promise.resolve([
        { id: 'dev:/repo', name: 'repo', path: '/repo', branch: 'main', status: 'inactive' },
      ]),
    },
    ports: { scan: () => Promise.resolve([]) },
    ai: {
      ollama: { status: () => Promise.resolve({ connected: false }), chat: () => Promise.resolve(''), models: () => Promise.resolve([]) },
      claude: { chat: () => Promise.resolve('') },
      onStream: () => () => {},
    },
    process: { onStatus: () => () => {} },
    terminal: {
      create: () => Promise.resolve({ success: true }),
      write: () => {}, resize: () => {}, destroy: () => {},
      onData: () => () => {}, onExit: () => () => {},
    },
    system: {
      appVersion: () => Promise.resolve('smoke-test'),
      detectShells: () => Promise.resolve([]),
      detectAgents: () => Promise.resolve([]),
      agentContextGroups: () => Promise.resolve([]),
      ollamaVersion: () => Promise.resolve(''),
    },
    window: {
      minimize: () => {}, maximize: () => {}, close: () => {},
      isMaximized: () => Promise.resolve(false),
      setAlwaysOnTop: () => Promise.resolve(),
      setOpacity: () => Promise.resolve(),
    },
    settings: {
      get: () => Promise.resolve(null),
      getAll: () => Promise.resolve({ terminalFontSize: 14 }),
      getSecure: () => Promise.resolve(null),
      set: () => {},
    },
    sessionHistory: { list: () => Promise.resolve([]), getOutput: () => Promise.resolve(''), start: () => Promise.resolve() },
    files: {
      tree: (dirPath) => Promise.resolve(dirPath === '/repo'
        ? { entries: [{ name: 'AGENTS.md', path: '/repo/AGENTS.md', type: 'file' }], meta: { truncated: false } }
        : { entries: [], meta: { truncated: false } }),
      read: () => Promise.resolve({ content: '# AGENTS\\n\\nLayout smoke content.', readOnly: false }),
      write: () => Promise.resolve({ success: true }),
      stat: () => Promise.resolve({ exists: true, size: 32, mtime: Date.now() }),
      gitStatus: () => Promise.resolve({}),
      gitOp: () => Promise.resolve({ success: true }),
      watch: () => {}, stopWatch: () => {},
      onChanged: () => () => {}, onGitStatus: () => () => {},
    },
    profiles: { get: () => Promise.resolve(null), save: () => Promise.resolve(), delete: () => Promise.resolve(), list: () => Promise.resolve([]) },
    prompts: { list: () => Promise.resolve([]), get: () => Promise.resolve(null), save: () => Promise.resolve(), delete: () => Promise.resolve() },
    shell: { openExternal: () => {}, showItemInFolder: () => {} },
    clipboard: { read: () => Promise.resolve(''), write: () => {} },
    telegram: { test: () => Promise.resolve(null), notify: () => Promise.resolve(null) },
    nockcc: { updateActivity: () => {} },
  };
"""


def run():
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={ 'width': 1600, 'height': 900 })
    page.add_init_script(NOCK_TERMINAL_MOCK)
    page.goto(APP_URL, wait_until='networkidle', timeout=TIMEOUT_MS)
    page.get_by_text('AGENTS.md').click(timeout=TIMEOUT_MS)
    page.wait_for_selector('.monaco-editor', timeout=TIMEOUT_MS)

    metrics = page.evaluate("""
      () => {
        const editor = document.querySelector('.monaco-editor');
        const textarea = document.querySelector('.monaco-editor textarea');
        const rect = editor?.getBoundingClientRect();
        return {
          editorHeight: rect?.height || 0,
          editorWidth: rect?.width || 0,
          textAreaValue: textarea?.value || '',
        };
      }
    """)
    browser.close()

  print(metrics)
  if metrics['editorHeight'] < 300 or metrics['editorWidth'] < 300:
    print('FAIL - editor surface collapsed', file=sys.stderr)
    sys.exit(1)
  print('PASS - editor surface has usable size')


if __name__ == '__main__':
  run()
