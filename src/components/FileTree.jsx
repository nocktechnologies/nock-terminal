import React, { useState, useEffect, useCallback, useRef } from 'react';

const GIT_STATUS_COLORS = {
  M: 'bg-nock-yellow',
  A: 'bg-nock-green',
  D: 'bg-red-400',
  '?': 'bg-nock-text-muted',
  '??': 'bg-nock-text-muted',
};

export default function FileTree({ rootPath, onFileClick, onCtrlPFocus }) {
  const [tree, setTree] = useState([]);
  const [gitStatus, setGitStatus] = useState({});
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const filterRef = useRef(null);

  const loadTree = useCallback(async () => {
    if (!rootPath) return;
    const result = await window.nockTerminal.files.tree(rootPath);
    setTree(result);
  }, [rootPath]);

  useEffect(() => {
    loadTree();
    window.nockTerminal.files.watch(rootPath);
    const cleanupChanged = window.nockTerminal.files.onChanged(() => loadTree());
    const cleanupGit = window.nockTerminal.files.onGitStatus((status) => setGitStatus(status));

    return () => {
      cleanupChanged();
      cleanupGit();
      window.nockTerminal.files.stopWatch();
    };
  }, [rootPath, loadTree]);

  useEffect(() => {
    if (onCtrlPFocus) {
      onCtrlPFocus(() => filterRef.current?.focus());
    }
  }, [onCtrlPFocus]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 120);
    setContextMenu({ x, y, node });
  };

  const filterNodes = (nodes) => {
    if (!filter) return nodes;
    const lower = filter.toLowerCase();
    return nodes.reduce((acc, node) => {
      if (node.type === 'file' && node.name.toLowerCase().includes(lower)) {
        acc.push(node);
      } else if (node.type === 'dir') {
        const filteredChildren = filterNodes(node.children || []);
        if (filteredChildren.length > 0) {
          acc.push({ ...node, children: filteredChildren });
        }
      }
      return acc;
    }, []);
  };

  const filteredTree = filterNodes(tree);

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="px-2 pb-2">
        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files..."
          className="w-full bg-nock-card border border-nock-border rounded px-2 py-1 text-[10px] text-nock-text font-mono focus:outline-none focus:border-nock-accent-blue placeholder:text-nock-text-muted"
        />
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1">
        {filteredTree.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            gitStatus={gitStatus}
            rootPath={rootPath}
            onFileClick={onFileClick}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {contextMenu && (
        <div
          className="fixed bg-nock-card border border-nock-border rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { onFileClick(contextMenu.node.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Open in Editor
          </button>
          <button
            onClick={() => { window.nockTerminal.shell.openExternal(contextMenu.node.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Open in External Editor
          </button>
          <div className="border-t border-nock-border my-1" />
          <button
            onClick={() => { window.nockTerminal.clipboard.write(contextMenu.node.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Copy Path
          </button>
          <button
            onClick={() => {
              const parentDir = contextMenu.node.path.replace(/[/\\][^/\\]+$/, '');
              window.nockTerminal.shell.openExternal(parentDir);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-nock-text hover:bg-nock-border/50 transition-colors"
          >
            Reveal in Explorer
          </button>
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, depth, gitStatus, rootPath, onFileClick, onContextMenu }) {
  const [expanded, setExpanded] = useState(depth < 1);

  const relativePath = node.path.replace(rootPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
  const statusCode = gitStatus[relativePath] || gitStatus[relativePath.replace(/\//g, '\\')];

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="w-full text-left flex items-center gap-1 py-0.5 hover:bg-nock-card/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <span className="text-[10px] text-nock-accent-blue w-3 shrink-0">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="text-[10px] text-nock-accent-blue truncate">{node.name}/</span>
        </button>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            gitStatus={gitStatus}
            rootPath={rootPath}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick(node.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
      className="w-full text-left flex items-center gap-1.5 py-0.5 hover:bg-nock-card/50 rounded transition-colors"
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      <span className="text-[10px] text-nock-text truncate">{node.name}</span>
      {statusCode && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${GIT_STATUS_COLORS[statusCode] || 'bg-nock-text-muted'}`} />
      )}
    </button>
  );
}
