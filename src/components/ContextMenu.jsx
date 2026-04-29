import React, { useEffect, useRef } from 'react';

export default function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null);

  // Clamp position to viewport
  const menuWidth = 180;
  const itemHeight = 32;
  const separatorCount = items.filter(i => i.separator).length;
  const regularCount = items.length - separatorCount;
  const estimatedHeight = regularCount * itemHeight + separatorCount * 9 + 8; // py-1 = 4px top+bottom

  const clampedX = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 4));
  const clampedY = Math.max(4, Math.min(y, window.innerHeight - estimatedHeight - 4));

  // Focus first menuitem on open
  useEffect(() => {
    const first = menuRef.current?.querySelector('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, []);

  // Close on mousedown outside; Escape closes
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  const handleKeyDown = (e) => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? []
    );
    if (!menuItems.length) return;
    const focused = menuRef.current.querySelector('[role="menuitem"]:focus');
    const idx = menuItems.indexOf(focused);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuItems[idx < 0 ? 0 : (idx + 1) % menuItems.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuItems[idx < 0 ? menuItems.length - 1 : (idx - 1 + menuItems.length) % menuItems.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuItems[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      menuItems[menuItems.length - 1].focus();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      className="fixed bg-nock-card border border-nock-border rounded-lg shadow-2xl py-1 z-50 min-w-[170px] backdrop-blur-sm"
      style={{ left: clampedX, top: clampedY }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="border-t border-nock-border my-1" />;
        }

        const disabled = item.disabled;
        const danger = item.danger;

        return (
          <button
            key={item.label}
            role="menuitem"
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) {
                item.onClick?.();
                onClose();
              }
            }}
            disabled={disabled}
            className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center gap-2 ${
              disabled
                ? 'opacity-40 cursor-default'
                : danger
                  ? 'text-red-400 hover:bg-red-500/10 cursor-pointer'
                  : 'text-nock-text hover:bg-nock-border-bright/30 cursor-pointer'
            }`}
          >
            {item.icon && <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-[9px] text-nock-text-muted font-mono ml-2 shrink-0">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
