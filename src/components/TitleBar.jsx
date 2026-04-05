import React, { useState, useEffect } from 'react';

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await window.nockTerminal.window.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();
  }, []);

  const handleMinimize = () => window.nockTerminal.window.minimize();
  const handleMaximize = async () => {
    window.nockTerminal.window.maximize();
    const maximized = await window.nockTerminal.window.isMaximized();
    setIsMaximized(maximized);
  };
  const handleClose = () => window.nockTerminal.window.close();

  return (
    <div className="titlebar-drag h-9 bg-nock-bg border-b border-nock-border flex items-center justify-between px-3 select-none shrink-0">
      {/* App title */}
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded nock-gradient-bg" />
        <span className="text-sm font-semibold nock-gradient-text tracking-wide">
          NOCK TERMINAL
        </span>
      </div>

      {/* Window controls */}
      <div className="titlebar-no-drag flex items-center gap-0.5">
        <button
          onClick={handleMinimize}
          className="w-8 h-7 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
          title="Minimize"
        >
          <svg className="w-3 h-0.5" fill="currentColor" viewBox="0 0 12 2">
            <rect width="12" height="2" rx="1" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-8 h-7 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
              <rect x="2" y="4" width="7" height="7" rx="1" />
              <path d="M4 4V3a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-7 flex items-center justify-center hover:bg-red-500/80 rounded transition-colors"
          title="Close"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
