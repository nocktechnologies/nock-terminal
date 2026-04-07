import React, { useState, useRef, useCallback, useEffect } from 'react';

export default function SplitPane({
  children,
  rightPane = null,
  direction = 'horizontal',
  defaultRatio = 0.5,
  minSize = 200,
  onRatioChange,
}) {
  const [ratio, setRatio] = useState(defaultRatio);
  const containerRef = useRef(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let newRatio;
      if (direction === 'horizontal') {
        newRatio = (e.clientX - rect.left) / rect.width;
      } else {
        newRatio = (e.clientY - rect.top) / rect.height;
      }
      const containerSize = direction === 'horizontal' ? rect.width : rect.height;
      const minRatio = minSize / containerSize;
      const maxRatio = 1 - minRatio;
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));
      setRatio(newRatio);
      onRatioChange?.(newRatio);
    };

    const handleMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [direction, minSize, onRatioChange]);

  useEffect(() => {
    setRatio(defaultRatio);
  }, [defaultRatio]);

  const isHorizontal = direction === 'horizontal';
  const hasSplit = !!rightPane;

  // Always render the same DOM structure so children (e.g. TerminalView)
  // are never unmounted/remounted when the split opens or closes.
  return (
    <div
      ref={containerRef}
      className={`flex-1 flex overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div
        style={{ [isHorizontal ? 'width' : 'height']: hasSplit ? `${ratio * 100}%` : '100%' }}
        className="overflow-hidden relative"
      >
        {children}
      </div>

      {hasSplit && (
        <>
          <div
            onMouseDown={handleMouseDown}
            className={`shrink-0 relative group ${
              isHorizontal
                ? 'w-[3px] cursor-col-resize hover:w-[5px]'
                : 'h-[3px] cursor-row-resize hover:h-[5px]'
            } bg-nock-border transition-all`}
          >
            <div
              className={`absolute bg-nock-border-bright rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${
                isHorizontal
                  ? 'left-[-2px] top-1/2 -translate-y-1/2 w-[7px] h-6'
                  : 'top-[-2px] left-1/2 -translate-x-1/2 h-[7px] w-6'
              }`}
            />
          </div>

          <div
            style={{ [isHorizontal ? 'width' : 'height']: `${(1 - ratio) * 100}%` }}
            className="overflow-hidden relative"
          >
            {rightPane}
          </div>
        </>
      )}
    </div>
  );
}
