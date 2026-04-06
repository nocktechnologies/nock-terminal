import React, { useState, useEffect } from 'react';

const STATUS_COLORS = {
  active:   'bg-nock-green',
  recent:   'bg-nock-yellow',
  inactive: 'bg-nock-text-muted',
};

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab, getSessionStatus }) {
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const handleContextMenu = (e, tab) => {
    e.preventDefault();
    const MENU_W = 150;
    const MENU_H = 80;
    const x = Math.max(0, Math.min(e.clientX, window.innerWidth - MENU_W - 4));
    const y = Math.max(0, Math.min(e.clientY, window.innerHeight - MENU_H - 4));
    setContextMenu({ x, y, tabId: tab.id });
  };

  const closeOthers = (tabId) => {
    tabs.forEach(t => { if (t.id !== tabId) onTabClose(t.id); });
    setContextMenu(null);
  };

  return (
    <div className="bg-nock-bg flex items-center shrink-0 h-9 relative flex-1">
      <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onTabClick(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
              className={`group relative flex items-center gap-2 px-3.5 h-9 cursor-pointer shrink-0 max-w-[220px] transition-all ${
                isActive
                  ? 'bg-nock-card text-nock-text'
                  : 'text-nock-text-dim hover:text-nock-text hover:bg-nock-card/40'
              }`}
            >
              {/* Active tab gradient underline */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-nock-accent-blue via-nock-accent-purple to-nock-accent-cyan" />
              )}
              {/* Right border separator */}
              <div className="absolute right-0 top-2 bottom-2 w-px bg-nock-border" />

              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                (() => {
                  const status = getSessionStatus?.(tab.id) || tab.status;
                  if (status === 'ready') return 'bg-nock-green';
                  if (status === 'active') return 'bg-nock-yellow animate-pulse-glow';
                  return 'bg-red-400';
                })()
              }`} />
              <span className="text-[11px] truncate font-medium">{tab.title}</span>
              {tab.branch && (
                <span className="font-mono text-[9px] text-nock-accent-blue truncate hidden sm:inline tracking-tight">
                  {tab.branch}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
                className={`ml-auto shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 transition-all ${
                  isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                }`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 12 12">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* New tab button */}
      <button
        onClick={() => onNewTab()}
        className="w-9 h-9 flex items-center justify-center text-nock-text-muted hover:text-nock-accent-purple hover:bg-nock-card/40 transition-colors shrink-0 border-l border-nock-border"
        title="New Tab (Ctrl+T)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-nock-card border border-nock-border rounded-lg shadow-2xl py-1 z-50 min-w-[140px] backdrop-blur-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { onTabClose(contextMenu.tabId); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-nock-text hover:bg-nock-border-bright/30 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => closeOthers(contextMenu.tabId)}
            className="w-full text-left px-3 py-1.5 text-[11px] text-nock-text hover:bg-nock-border-bright/30 transition-colors"
          >
            Close Others
          </button>
        </div>
      )}
    </div>
  );
}
