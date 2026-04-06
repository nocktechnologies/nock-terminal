import React from 'react';

export default function ActionToolbar({
  onSplit,
  onToggleSidebar,
  onToggleChat,
  onDashboard,
  sidebarOpen,
  chatOpen,
  hasSplit,
}) {
  return (
    <div className="flex items-center gap-1 px-2 shrink-0">
      <ToolbarButton
        icon="⊞"
        label="Split"
        shortcut="Ctrl+Shift+D"
        onClick={onSplit}
        active={hasSplit}
      />
      <ToolbarButton
        icon="◧"
        label="Sidebar"
        shortcut="Ctrl+B"
        onClick={onToggleSidebar}
        active={sidebarOpen}
      />
      <ToolbarButton
        icon="💬"
        label="Chat"
        shortcut="Ctrl+Shift+A"
        onClick={onToggleChat}
        active={chatOpen}
      />
      <ToolbarButton
        icon="⊟"
        label="Dash"
        shortcut="Ctrl+D"
        onClick={onDashboard}
      />
    </div>
  );
}

function ToolbarButton({ icon, label, shortcut, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono transition-all border ${
        active
          ? 'bg-gradient-to-r from-nock-accent-blue/10 to-nock-accent-purple/10 border-nock-accent-blue/30 text-nock-text'
          : 'bg-nock-card border-nock-border text-nock-text-dim hover:text-nock-text hover:border-nock-border-bright'
      }`}
      title={`${label} (${shortcut})`}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
