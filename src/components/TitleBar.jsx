import React, { useState, useEffect } from 'react';

export default function TitleBar({ sessionCount = 0, activeCount = 0 }) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.nockTerminal.window.isMaximized().then(setIsMaximized);
  }, []);

  const handleMinimize = () => window.nockTerminal.window.minimize();
  const handleMaximize = async () => {
    window.nockTerminal.window.maximize();
    setIsMaximized(await window.nockTerminal.window.isMaximized());
  };
  const handleClose = () => window.nockTerminal.window.close();

  return (
    <div className="titlebar-drag h-10 bg-nock-bg border-b border-nock-border flex items-center justify-between px-3 select-none shrink-0 relative">
      {/* Subtle bottom accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-nock-accent-blue/30 to-transparent pointer-events-none" />

      {/* Left: Logo + wordmark */}
      <div className="flex items-center gap-2.5">
        <img
          src="./nock-logo.png"
          alt="Nock"
          className="w-5 h-5 drop-shadow-[0_0_8px_rgba(124,92,252,0.5)]"
          draggable={false}
        />
        <div className="flex items-baseline gap-2">
          <span className="font-display font-semibold text-[13px] text-nock-text tracking-widest-plus uppercase">
            NOCK
          </span>
          <span className="font-display font-normal text-[11px] text-nock-text-dim tracking-widest-plus uppercase">
            TERMINAL
          </span>
        </div>
      </div>

      {/* Center: Live telemetry */}
      <div className="titlebar-no-drag flex items-center gap-4 absolute left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-nock-green shadow-glow-green animate-pulse-glow" />
          <span className="font-mono text-[10px] text-nock-text-dim tracking-wider uppercase">
            {activeCount} active
          </span>
        </div>
        <div className="w-px h-3 bg-nock-border" />
        <span className="font-mono text-[10px] text-nock-text-dim tracking-wider uppercase tabular-nums">
          {sessionCount} sessions
        </span>
      </div>

      {/* Right: Window controls */}
      <div className="titlebar-no-drag flex items-center gap-0.5">
        <button
          onClick={handleMinimize}
          className="w-9 h-7 flex items-center justify-center hover:bg-white/5 rounded transition-colors text-nock-text-dim hover:text-nock-text"
          title="Minimize"
          aria-label="Minimize"
        >
          <svg className="w-3 h-0.5" fill="currentColor" viewBox="0 0 12 2">
            <rect width="12" height="2" rx="1" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-9 h-7 flex items-center justify-center hover:bg-white/5 rounded transition-colors text-nock-text-dim hover:text-nock-text"
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
              <rect x="2" y="4" width="7" height="7" rx="0.5" />
              <path d="M4 4V3a0.5 0.5 0 01.5-.5h5a0.5 0.5 0 01.5.5v5a0.5 0.5 0 01-.5.5H9" />
            </svg>
          ) : (
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
              <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-9 h-7 flex items-center justify-center hover:bg-red-500/80 rounded transition-colors text-nock-text-dim hover:text-white"
          title="Close"
          aria-label="Close window"
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
