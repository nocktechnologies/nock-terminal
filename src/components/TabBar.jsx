import React, { useState, useRef, useCallback } from 'react';
import { Pin } from 'lucide-react';
import ContextMenu from './ContextMenu';

const STATUS_COLORS = {
  active:   'bg-nock-green',
  recent:   'bg-nock-yellow',
  inactive: 'bg-nock-text-muted',
};

export default function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  getSessionStatus,
  onTabRename,
  onTabPin,
  onTabDuplicate,
  onSplit,
  onTabReorder,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const dragTabIdRef = useRef(null);

  // --- Context menu ---
  const handleContextMenu = (e, tab) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tab });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // --- Inline rename ---
  const startRename = useCallback((tab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
    // Focus the input on next tick
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingTabId && renameValue.trim()) {
      onTabRename?.(renamingTabId, renameValue.trim());
    }
    setRenamingTabId(null);
    setRenameValue('');
  }, [renamingTabId, renameValue, onTabRename]);

  const cancelRename = useCallback(() => {
    setRenamingTabId(null);
    setRenameValue('');
  }, []);

  const handleRenameKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }, [commitRename, cancelRename]);

  // --- Drag and drop ---
  const handleDragStart = useCallback((e, tabId) => {
    dragTabIdRef.current = tabId;
    e.dataTransfer.effectAllowed = 'move';
    // Make drag image semi-transparent
    if (e.currentTarget) {
      e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
    }
  }, []);

  const handleDragOver = useCallback((e, targetTabId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragTabIdRef.current && dragTabIdRef.current !== targetTabId) {
      onTabReorder?.(dragTabIdRef.current, targetTabId);
    }
  }, [onTabReorder]);

  const handleDragEnd = useCallback(() => {
    dragTabIdRef.current = null;
  }, []);

  // --- Build context menu items ---
  const buildMenuItems = (tab) => {
    const items = [
      {
        label: 'Rename',
        onClick: () => startRename(tab),
      },
      {
        label: tab.pinned ? 'Unpin' : 'Pin',
        icon: <Pin size={12} />,
        onClick: () => onTabPin?.(tab.id),
      },
      { separator: true },
      {
        label: 'Split Terminal',
        shortcut: 'Ctrl+Shift+D',
        onClick: () => {
          onTabClick(tab.id);
          onSplit?.();
        },
      },
      {
        label: 'Duplicate',
        onClick: () => onTabDuplicate?.(tab),
      },
      { separator: true },
      {
        label: 'Close',
        shortcut: 'Ctrl+W',
        disabled: !!tab.pinned,
        onClick: () => onTabClose(tab.id),
      },
      {
        label: 'Close Others',
        danger: true,
        onClick: () => {
          tabs.forEach(t => {
            if (t.id !== tab.id && !t.pinned) onTabClose(t.id);
          });
        },
      },
    ];
    return items;
  };

  return (
    <div className="bg-nock-bg flex items-center shrink-0 h-9 relative flex-1">
      <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isRenaming = tab.id === renamingTabId;

          return (
            <div
              key={tab.id}
              draggable={!isRenaming}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, tab.id)}
              onDragEnd={handleDragEnd}
              onClick={() => onTabClick(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(tab);
              }}
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

              {/* Pin indicator */}
              {tab.pinned && (
                <Pin size={10} className="text-nock-accent-cyan shrink-0" />
              )}

              {/* Status dot */}
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                (() => {
                  const status = getSessionStatus?.(tab.id) || tab.status;
                  if (status === 'ready') return 'bg-nock-green';
                  if (status === 'active') return 'bg-nock-yellow animate-pulse-glow';
                  return 'bg-red-400';
                })()
              }`} />

              {/* Title — inline rename or static */}
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="bg-nock-bg border border-nock-accent-blue rounded px-1 py-0 text-[11px] text-nock-text font-medium w-20 focus:outline-none"
                  autoFocus
                />
              ) : (
                <span className="text-[11px] truncate font-medium">{tab.title}</span>
              )}

              {/* Branch badge */}
              {tab.branch && !isRenaming && (
                <span className="font-mono text-[9px] text-nock-accent-blue truncate hidden sm:inline tracking-tight">
                  {tab.branch}
                </span>
              )}

              {/* Close button (hidden if pinned) */}
              {!tab.pinned && (
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
              )}
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
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu.tab)}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
