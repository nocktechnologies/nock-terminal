import React, { useState, useRef, useEffect } from 'react';
import { statusColors } from '../utils/themes';

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }) {
  const [contextMenu, setContextMenu] = useState(null);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const handleContextMenu = (e, tab) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabId: tab.id,
    });
  };

  const closeOthers = (tabId) => {
    tabs.forEach(t => {
      if (t.id !== tabId) onTabClose(t.id);
    });
    setContextMenu(null);
  };

  return (
    <div className="bg-nock-bg border-b border-nock-border flex items-center shrink-0 h-9">
      {/* Tabs */}
      <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => onTabClick(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
            className={`flex items-center gap-2 px-3 h-9 cursor-pointer border-r border-nock-border shrink-0 max-w-[200px] transition-colors ${
              tab.id === activeTabId
                ? 'bg-nock-card text-nock-text'
                : 'text-nock-text-dim hover:text-nock-text hover:bg-nock-card/50'
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: statusColors[tab.status] || statusColors.active }}
            />
            <span className="text-xs truncate">{tab.title}</span>
            {tab.branch && (
              <span className="text-[10px] text-nock-accent-blue font-mono truncate hidden sm:inline">
                {tab.branch}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className="ml-auto shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
              style={{ opacity: tab.id === activeTabId ? 0.6 : 0 }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
              onMouseLeave={(e) => e.currentTarget.style.opacity = tab.id === activeTabId ? 0.6 : 0}
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 12 12">
                <path d="M2 2l8 8M10 2l-8 8" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* New tab button */}
      <button
        onClick={() => onNewTab()}
        className="w-9 h-9 flex items-center justify-center text-nock-text-dim hover:text-nock-text hover:bg-nock-card/50 transition-colors shrink-0 border-l border-nock-border"
        title="New Tab (Ctrl+T)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-nock-card border border-nock-border rounded-lg shadow-xl py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { onTabClose(contextMenu.tabId); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => closeOthers(contextMenu.tabId)}
            className="w-full text-left px-3 py-1.5 text-xs text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Close Others
          </button>
        </div>
      )}
    </div>
  );
}
