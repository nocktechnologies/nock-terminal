import React, { useEffect, useRef, useState } from 'react';
import { pitchBlack } from '../utils/themes';

export default function TerminalView({ tabId, cwd, active, launchCommand }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [initialized, setInitialized] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y } | null

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
  const copySelection = () => {
    const term = terminalRef.current;
    if (!term) return false;
    const selection = term.getSelection();
    if (selection) {
      window.nockTerminal.clipboard.write(selection);
      return true;
    }
    return false;
  };

  useEffect(() => {
    let term = null;
    let fitAddon = null;
    let cleanupData = null;
    let cleanupExit = null;
    let launchTimer = null;

    const init = async () => {
      // Dynamic import xterm (ESM modules)
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');

      // Import xterm CSS
      await import('xterm/css/xterm.css');

      if (!containerRef.current) return;

      // Load font settings (fall back to defaults)
      const settings = await window.nockTerminal.settings.getAll();
      const fontSize = settings?.terminalFontSize ?? 16;
      const fontFamily = settings?.terminalFontFamily ?? "'JetBrains Mono', 'Consolas', monospace";
      const cursorStyle = settings?.cursorStyle || 'block';
      const cursorBlink = settings?.cursorBlink ?? true;
      const scrollback = settings?.scrollbackSize || 5000;

      term = new Terminal({
        cursorBlink,
        cursorStyle,
        fontSize,
        fontFamily,
        scrollback,
        lineHeight: 1.2,
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

      // Intercept Ctrl+C to copy-on-selection (fall through as SIGINT otherwise).
      // Ctrl+V is handled natively by xterm via the browser paste event on its
      // backing textarea — do NOT intercept it here or paste will fire twice.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        if (!e.ctrlKey || e.altKey || e.metaKey) return true;

        const key = e.key.toLowerCase();
        if (key === 'c' && !e.shiftKey) {
          if (term.hasSelection()) {
            window.nockTerminal.clipboard.write(term.getSelection());
            return false;
          }
          return true; // no selection → let SIGINT through
        }
        if (e.shiftKey && key === 'c') {
          // Ctrl+Shift+C — always copy
          if (term.hasSelection()) {
            window.nockTerminal.clipboard.write(term.getSelection());
          }
          return false;
        }
        return true;
      });

      term.open(containerRef.current);
      fitAddon.fit();

      // Mouse wheel in the alt-screen buffer (TUIs like claude, vim, less) is
      // translated by xterm into arrow keys, which makes claude cycle its
      // input history into the chat bar on scroll. Intercept in capture phase
      // and scroll the viewport instead so wheel = scroll, never = input nav.
      const handleWheel = (e) => {
        if (term.buffer.active.type !== 'alternate') return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.deltaMode === 1 ? 1 : 24;
        term.scrollLines(Math.round(e.deltaY / step));
      };
      containerRef.current.addEventListener('wheel', handleWheel, { capture: true, passive: false });
      term._wheelCleanup = () => containerRef.current?.removeEventListener('wheel', handleWheel, { capture: true });

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      // Create the pty process
      const result = await window.nockTerminal.terminal.create({
        id: tabId,
        cwd: cwd,
      });

      if (!result.success) {
        term.writeln(`\x1b[31mFailed to create terminal: ${result.error}\x1b[0m`);
        return;
      }

      // If a launch command is specified, send it to the pty after a short
      // delay so the shell prompt has time to initialize.
      if (launchCommand) {
        launchTimer = setTimeout(() => {
          window.nockTerminal.terminal.write(tabId, launchCommand + '\r');
        }, 500);
      }

      // Wire input: terminal → pty
      term.onData((data) => {
        window.nockTerminal.terminal.write(tabId, data);
      });

      // Wire output: pty → terminal
      cleanupData = window.nockTerminal.terminal.onData((id, data) => {
        if (id === tabId && term) {
          term.write(data);
        }
      });

      // Handle exit
      cleanupExit = window.nockTerminal.terminal.onExit((id, code) => {
        if (id === tabId && term) {
          term.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
        }
      });

      // Send initial size
      window.nockTerminal.terminal.resize(tabId, term.cols, term.rows);

      setInitialized(true);
    };

    init();

    return () => {
      if (launchTimer) clearTimeout(launchTimer);
      if (cleanupData) cleanupData();
      if (cleanupExit) cleanupExit();
      if (term) {
        term._wheelCleanup?.();
        term.dispose();
        terminalRef.current = null;
      }
    };
  }, [tabId, cwd, launchCommand]);

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
    setContextMenu({ x, y });
  };

  const hasSelection = terminalRef.current?.hasSelection?.() ?? false;

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
            onClick={() => {
              copySelection();
              setContextMenu(null);
            }}
            disabled={!hasSelection}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-between"
          >
            <span>Copy</span>
            <kbd className="text-[9px] text-nock-text-dim font-mono">Ctrl+C</kbd>
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
    </div>
  );
}
