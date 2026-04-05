import React, { useEffect, useRef, useState } from 'react';
import { pitchBlack } from '../utils/themes';

export default function TerminalView({ tabId, cwd, active }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let term = null;
    let fitAddon = null;
    let cleanupData = null;
    let cleanupExit = null;

    const init = async () => {
      // Dynamic import xterm (ESM modules)
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');

      // Import xterm CSS
      await import('xterm/css/xterm.css');

      if (!containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
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

      term.open(containerRef.current);
      fitAddon.fit();

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
      if (cleanupData) cleanupData();
      if (cleanupExit) cleanupExit();
      if (term) {
        term.dispose();
        terminalRef.current = null;
      }
    };
  }, [tabId, cwd]);

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

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (active && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="terminal-container w-full h-full bg-nock-bg"
    />
  );
}
