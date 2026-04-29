"""
Monaco smoke test — verifies Monaco loads without worker errors when
vite-plugin-monaco-editor is disabled.

Strategy:
  1. Load the Vite dev server app with a window.nockTerminal mock
  2. Discover the actual Vite-resolved URL for monaco-editor (same URL EditorPane uses)
  3. Call import(vite_url) from page context — identical to what EditorPane.jsx does
  4. Create an editor, verify it mounts + accepts input, screenshot as evidence

Requires dev server running: npx vite &
Usage: python3 test/monaco.smoke.py
"""
import re
import sys
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = Path(__file__).parent / 'screenshots'
APP_URL = 'http://localhost:5173'
TIMEOUT_MS = 30_000

NOCK_TERMINAL_MOCK = """
  window.nockTerminal = {
    sessions:     { discover: () => Promise.resolve([]) },
    ports:        { scan: () => Promise.resolve([]) },
    ai:           { ollama: { status: () => Promise.resolve({ connected: false }),
                              chat: () => Promise.resolve(''),
                              models: () => Promise.resolve([]) },
                    claude:  { chat: () => Promise.resolve('') },
                    onStream: () => () => {} },
    process:      { onStatus: () => () => {} },
    terminal:     { create: () => Promise.resolve(null),
                    write: () => {}, resize: () => {}, destroy: () => {},
                    onData: () => () => {}, onExit: () => () => {} },
    system:       { appVersion: () => Promise.resolve('smoke-test'),
                    detectShells: () => Promise.resolve([]),
                    ollamaVersion: () => Promise.resolve('') },
    window:       { minimize: () => {}, maximize: () => {}, close: () => {},
                    isMaximized: () => Promise.resolve(false),
                    setAlwaysOnTop: () => Promise.resolve(),
                    setOpacity: () => Promise.resolve() },
    settings:     { get: () => Promise.resolve(null), getAll: () => Promise.resolve({}),
                    getSecure: () => Promise.resolve(null), set: () => {} },
    sessionHistory: { list: () => Promise.resolve([]), getOutput: () => Promise.resolve(''),
                      start: () => Promise.resolve() },
    files:        { tree: () => Promise.resolve([]),
                    read: () => Promise.resolve({ content: 'const x = 1;', readOnly: false }),
                    write: () => Promise.resolve({ success: true }),
                    stat: () => Promise.resolve(null),
                    gitStatus: () => Promise.resolve(null),
                    gitOp: () => Promise.resolve({ success: true }),
                    watch: () => {}, stopWatch: () => {},
                    onChanged: () => () => {}, onGitStatus: () => () => {} },
    profiles:     { get: () => Promise.resolve(null), save: () => Promise.resolve(),
                    delete: () => Promise.resolve(), list: () => Promise.resolve([]) },
    prompts:      { list: () => Promise.resolve([]), get: () => Promise.resolve(null),
                    save: () => Promise.resolve(), delete: () => Promise.resolve() },
    shell:        { openExternal: () => {}, showItemInFolder: () => {} },
    clipboard:    { read: () => Promise.resolve(''), write: () => {} },
    telegram:     { test: () => Promise.resolve(null), notify: () => Promise.resolve(null) },
  };
"""


def discover_monaco_vite_url():
    """Read the Vite-transformed EditorPane to find the actual resolved monaco-editor URL."""
    with urllib.request.urlopen(f'{APP_URL}/src/components/EditorPane.jsx') as resp:
        body = resp.read().decode()
    match = re.search(r'import\(["\']([^"\']*monaco-editor[^"\']*)["\']', body)
    if not match:
        raise RuntimeError('Could not find monaco-editor import URL in Vite-transformed EditorPane.jsx')
    return match.group(1)


def run():
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    console_errors = []

    monaco_url = discover_monaco_vite_url()
    print(f'Discovered Vite monaco-editor URL: {monaco_url}')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.add_init_script(NOCK_TERMINAL_MOCK)
        page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
        page.on('pageerror', lambda err: console_errors.append(f'pageerror: {err}'))

        print(f'Loading {APP_URL} with mocked nockTerminal…')
        page.goto(APP_URL, wait_until='networkidle', timeout=TIMEOUT_MS)

        print(f'Running import({monaco_url!r}) in page context…')
        result = page.evaluate(f"""
          async () => {{
            try {{
              const monaco = await import('{monaco_url}');

              const container = document.createElement('div');
              container.style.cssText = [
                'position:fixed', 'top:0', 'left:0',
                'width:800px', 'height:400px', 'z-index:99999',
              ].join(';');
              document.body.appendChild(container);

              monaco.editor.defineTheme('smoke-dark', {{
                base: 'vs-dark', inherit: true, rules: [],
                colors: {{ 'editor.background': '#0D0D12' }},
              }});

              const editor = monaco.editor.create(container, {{
                value: [
                  'interface NockSession {{',
                  '  id: string;',
                  '  name: string;',
                  '}}',
                  '',
                  'async function getSession(id: string): Promise<NockSession | null> {{',
                  '  return null;',
                  '}}',
                ].join('\\n'),
                language: 'typescript',
                theme: 'smoke-dark',
                fontSize: 13,
                automaticLayout: false,
              }});

              editor.focus();
              editor.trigger('smoke', 'type', {{ text: '// smoke-verified\\n' }});

              const model = editor.getModel();
              return {{
                ok: true,
                lang: model.getLanguageId(),
                lineCount: model.getLineCount(),
              }};
            }} catch (e) {{
              return {{ ok: false, error: e.message }};
            }}
          }}
        """)

        shot_path = str(SCREENSHOT_DIR / 'monaco-smoke.png')
        page.screenshot(path=shot_path, full_page=False)
        print(f'Screenshot saved: {shot_path}')

        browser.close()

    print('\n--- Monaco Smoke Test Results ---')
    print(f'Monaco loaded:        {result.get("ok")}')
    print(f'Language:             {result.get("lang", "n/a")}')
    print(f'Lines in model:       {result.get("lineCount", "n/a")}')

    worker_errors = [e for e in console_errors if 'worker' in e.lower() or 'monaco' in e.lower()]
    print(f'Browser console errs: {console_errors if console_errors else "none"}')
    print(f'Worker/Monaco errors: {worker_errors if worker_errors else "none"}')
    print('---------------------------------\n')

    if result.get('error'):
        print(f'Import error: {result["error"]}', file=sys.stderr)

    passed = result.get('ok') is True and len(worker_errors) == 0

    if not passed:
        print('FAIL — Monaco smoke test did not pass', file=sys.stderr)
        sys.exit(1)

    print(f'PASS — Monaco renders (lang={result["lang"]}, {result["lineCount"]} lines), '
          'workers clean, keyboard input accepted')


if __name__ == '__main__':
    run()
