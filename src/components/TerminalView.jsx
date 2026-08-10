import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pitchBlack } from '../utils/themes';
import { sanitizeStagedTerminalInput } from '../utils/agentLaunchers.mjs';
import {
  decodeOsc52ClipboardRequest,
  OSC52_PROMPT_WINDOW_MS,
} from '../utils/terminalClipboard.mjs';
import TerminalClipboardDialog from './TerminalClipboardDialog';

const LAUNCH_COMMAND_DELAY_MS = 500;
const STAGED_INPUT_DELAY_MS = 1400;
const DIRECT_STAGED_INPUT_DELAY_MS = 700;

export default function TerminalView({
  tabId,
  cwd,
  active,
  launchCommand,
  initialInput,
  destroyOnUnmount = false,
}) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const activeRef = useRef(active);
  const osc52CopyArmedUntilRef = useRef(0);
  const [initialized, setInitialized] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, selection } | null
  const [pendingOsc52Copy, setPendingOsc52Copy] = useState(null);
  const copyShortcutLabel = /Mac/i.test(navigator.platform) ? 'Cmd+C' : 'Ctrl+Shift+C';

  // Paste clipboard content to the active pty
  const pasteFromClipboard = async () => {
    try {
      const text = await window.nockTerminal.clipboard.read();
      if (text) {
        window.nockTerminal.terminal.write(tabId, text);
      }
    } catch (err) {
      console.error('Clipboard read failed:', err);
    }
  };

  // Copy the current terminal selection to clipboard
  const copySelection = (selection = terminalRef.current?.getSelection() || '') => {
    if (selection) {
      window.nockTerminal.clipboard.write(selection);
      return true;
    }
    return false;
  };

  useEffect(() => {
    let disposed = false;
    let ptyCreated = false;
    let term = null;
    let fitAddon = null;
    let cleanupData = null;
    let cleanupExit = null;
    let launchTimer = null;
    let stagedInputTimer = null;

    const init = async () => {
      // Dynamic import xterm (ESM modules)
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');

      // Import xterm CSS
      await import('xterm/css/xterm.css');

      if (disposed || !containerRef.current) return;

      // Load settings and project profile overrides (fall back to defaults)
      const settings = await window.nockTerminal.settings.getAll();
      let profile = null;
      if (cwd) {
        try {
          profile = await window.nockTerminal.profiles.get(cwd);
        } catch {
          profile = null;
        }
      }
      if (disposed || !containerRef.current) return;
      const fontSize = settings?.terminalFontSize ?? 16;
      const fontFamily = settings?.terminalFontFamily ?? "'JetBrains Mono', 'Consolas', monospace";
      const cursorStyle = settings?.cursorStyle || 'block';
      const cursorBlink = settings?.cursorBlink ?? true;
      const scrollback = settings?.scrollbackSize || 5000;
      const shell = profile?.defaultShell || settings?.defaultShell || undefined;
      const shellArgs = profile?.shellArgs || settings?.shellArgs || '';
      const envVars = profile?.envVars || '';

      term = new Terminal({
        cursorBlink,
        cursorStyle,
        fontSize,
        fontFamily,
        scrollback,
        lineHeight: 1.2,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: true,
        theme: {
          background: pitchBlack.terminal.bg,
          foreground: pitchBlack.terminal.foreground,
          cursor: pitchBlack.terminal.cursor,
          cursorAccent: pitchBlack.terminal.cursorAccent,
          selectionBackground: pitchBlack.terminal.selectionBackground,
          black: pitchBlack.terminal.black,
          red: pitchBlack.terminal.red,
          green: pitchBlack.terminal.green,
          yellow: pitchBlack.terminal.yellow,
          blue: pitchBlack.terminal.blue,
          magenta: pitchBlack.terminal.magenta,
          cyan: pitchBlack.terminal.cyan,
          white: pitchBlack.terminal.white,
          brightBlack: pitchBlack.terminal.brightBlack,
          brightRed: pitchBlack.terminal.brightRed,
          brightGreen: pitchBlack.terminal.brightGreen,
          brightYellow: pitchBlack.terminal.brightYellow,
          brightBlue: pitchBlack.terminal.brightBlue,
          brightMagenta: pitchBlack.terminal.brightMagenta,
          brightCyan: pitchBlack.terminal.brightCyan,
          brightWhite: pitchBlack.terminal.brightWhite,
        },
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon((_, uri) => {
        window.nockTerminal.shell.openExternal(uri);
      });

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      term.parser.registerOscHandler(52, (data) => {
        const text = decodeOsc52ClipboardRequest(data, {
          active: activeRef.current,
          focused: document.hasFocus(),
          armedUntil: osc52CopyArmedUntilRef.current,
        });
        osc52CopyArmedUntilRef.current = 0;
        if (text !== null) {
          setPendingOsc52Copy(text);
        }
        return true;
      });

      // Copy selected text with the platform shortcut. Bare Ctrl+C still
      // reaches the PTY as SIGINT when there is no selection.
      // Ctrl+V is handled natively by xterm via the browser paste event on its
      // backing textarea — do NOT intercept it here or paste will fire twice.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const key = e.key.toLowerCase();
        const commandCopy = e.metaKey && !e.ctrlKey && !e.altKey && key === 'c';
        const explicitCopy = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && key === 'c';
        if (commandCopy || explicitCopy) {
          if (term.hasSelection()) {
            window.nockTerminal.clipboard.write(term.getSelection());
          }
          return false;
        }
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && key === 'c') {
          if (term.hasSelection()) {
            window.nockTerminal.clipboard.write(term.getSelection());
            return false;
          }
          return true; // no selection → let SIGINT through
        }
        return true;
      });

      term.open(containerRef.current);
      fitAddon.fit();

      // Mouse-reporting programs such as tmux own wheel behavior. Other TUIs
      // have no alternate-screen scrollback, so do not translate wheel input
      // into accidental arrow-key navigation.
      const handleWheel = (e) => {
        const mouseTracking = term.modes.mouseTrackingMode !== 'none';
        if (mouseTracking || term.buffer.active.type !== 'alternate') return;
        e.preventDefault();
        e.stopPropagation();
      };
      containerRef.current.addEventListener('wheel', handleWheel, { capture: true, passive: false });
      term._wheelCleanup = () => containerRef.current?.removeEventListener('wheel', handleWheel, { capture: true });

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      // Create the pty process
      const result = await window.nockTerminal.terminal.create({
        id: tabId,
        cwd: cwd,
        shell,
        shellArgs,
        envVars,
      });

      if (!result.success) {
        if (!disposed) term.writeln(`\x1b[31mFailed to create terminal: ${result.error}\x1b[0m`);
        return;
      }
      ptyCreated = true;
      if (disposed) {
        // A tab can close while the PTY create IPC is still in flight. Once
        // it resolves there is no renderer owner left, so always reap it.
        window.nockTerminal.terminal.destroy(tabId);
        return;
      }

      // If a launch command is specified, send it to the pty after a short
      // delay so the shell prompt has time to initialize.
      const stagedInput = sanitizeStagedTerminalInput(initialInput || '');
      if (launchCommand) {
        launchTimer = setTimeout(() => {
          window.nockTerminal.terminal.write(tabId, launchCommand + '\r');
          if (stagedInput) {
            stagedInputTimer = setTimeout(() => {
              window.nockTerminal.terminal.write(tabId, stagedInput);
            }, STAGED_INPUT_DELAY_MS);
          }
        }, LAUNCH_COMMAND_DELAY_MS);
      } else if (stagedInput) {
        stagedInputTimer = setTimeout(() => {
          window.nockTerminal.terminal.write(tabId, stagedInput);
        }, DIRECT_STAGED_INPUT_DELAY_MS);
      }

      // Wire input: terminal → pty
      term.onData((data) => {
        osc52CopyArmedUntilRef.current = data === 'c'
          ? Date.now() + OSC52_PROMPT_WINDOW_MS
          : 0;
        window.nockTerminal.terminal.write(tabId, data);
      });

      // Wire output: pty → terminal
      cleanupData = window.nockTerminal.terminal.onData((id, data) => {
        if (id === tabId && term) {
          term.write(data);
        }
      });

      // Handle exit
      cleanupExit = window.nockTerminal.terminal.onExit((id, code, details = {}) => {
        if (id === tabId && term) {
          const reasonLabels = {
            'dead-root-pid': 'root pid disappeared',
            'orphaned-renderer-tab': 'stale session cleaned',
            destroyed: 'closed',
          };
          const suffix = code == null
            ? `: ${reasonLabels[details.reason] || 'ended'}`
            : ` with code ${code}`;
          term.writeln(`\r\n\x1b[90m[Process exited${suffix}]\x1b[0m`);
        }
      });

      // Send initial size
      window.nockTerminal.terminal.resize(tabId, term.cols, term.rows);

      setInitialized(true);
    };

    init();

    return () => {
      disposed = true;
      if (launchTimer) clearTimeout(launchTimer);
      if (stagedInputTimer) clearTimeout(stagedInputTimer);
      if (cleanupData) cleanupData();
      if (cleanupExit) cleanupExit();
      if (term) {
        term._wheelCleanup?.();
        term.dispose();
        terminalRef.current = null;
      }
      if (destroyOnUnmount && ptyCreated) {
        window.nockTerminal.terminal.destroy(tabId);
      }
    };
    // initialInput is staged once at tab creation; re-running this effect on
    // its change would destroy and recreate the live terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, cwd, launchCommand, destroyOnUnmount]);

  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) {
      osc52CopyArmedUntilRef.current = 0;
      setPendingOsc52Copy(null);
    }
  }, [active]);

  // Refit on visibility change or window resize
  useEffect(() => {
    if (!active || !fitAddonRef.current) return;

    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = terminalRef.current;
          window.nockTerminal.terminal.resize(tabId, cols, rows);
        } catch {
          // Terminal may be disposed
        }
      }
    };

    // Fit immediately when tab becomes active
    requestAnimationFrame(handleResize);

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [active, tabId, initialized]);

  // Refresh + focus terminal when tab becomes active again
  useEffect(() => {
    if (active && terminalRef.current) {
      // Force canvas redraw after being hidden (visibility:hidden preserves
      // the DOM element but the canvas may need a repaint)
      terminalRef.current.refresh(0, terminalRef.current.rows - 1);
      terminalRef.current.focus();
    }
  }, [active]);

  // Close context menu on any click / escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    // Clamp menu position to viewport so it's never rendered off-screen
    // near the right/bottom edges (menu is ~160×140px at default font).
    const MENU_W = 160;
    const MENU_H = 140;
    const x = Math.max(0, Math.min(e.clientX, window.innerWidth - MENU_W - 4));
    const y = Math.max(0, Math.min(e.clientY, window.innerHeight - MENU_H - 4));
    // xterm selects the word under a right-click after React receives this
    // event. Read the selection on the next frame and keep it stable while the
    // menu itself takes focus.
    requestAnimationFrame(() => {
      const selection = terminalRef.current?.getSelection() || '';
      setContextMenu({ x, y, selection });
    });
  };

  // Drag-and-drop: paste file paths (or text) into terminal
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDrop = (e) => {
    e.preventDefault();
    // Files → paste paths (quoted if they contain spaces)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files)
        .map(f => f.path.includes(' ') ? `"${f.path}"` : f.path)
        .join(' ');
      window.nockTerminal.terminal.write(tabId, paths);
      return;
    }
    // Plain text fallback
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      window.nockTerminal.terminal.write(tabId, text);
    }
  };

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="terminal-container w-full h-full bg-nock-bg"
    >
      {contextMenu && (
        <div
          className="fixed bg-nock-card border border-nock-border rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              copySelection(contextMenu.selection);
              setContextMenu(null);
            }}
            disabled={!contextMenu.selection}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-between"
          >
            <span>Copy</span>
            <kbd className="text-[9px] text-nock-text-dim font-mono">{copyShortcutLabel}</kbd>
          </button>
          <button
            onClick={() => {
              pasteFromClipboard();
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors flex items-center justify-between"
          >
            <span>Paste</span>
            <kbd className="text-[9px] text-nock-text-dim font-mono">Ctrl+V</kbd>
          </button>
          <div className="border-t border-nock-border my-1" />
          <button
            onClick={() => {
              terminalRef.current?.selectAll();
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors flex items-center justify-between"
          >
            <span>Select All</span>
            <kbd className="text-[9px] text-nock-text-dim font-mono">Ctrl+A</kbd>
          </button>
          <button
            onClick={() => {
              terminalRef.current?.clear();
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Clear
          </button>
        </div>
      )}
      {pendingOsc52Copy !== null && (
        <TerminalClipboardDialog
          text={pendingOsc52Copy}
          source={cwd || 'Shell terminal'}
          onCancel={() => setPendingOsc52Copy(null)}
          onConfirm={() => {
            window.nockTerminal.clipboard.write(pendingOsc52Copy);
            setPendingOsc52Copy(null);
          }}
        />
      )}
    </div>
  );
}
