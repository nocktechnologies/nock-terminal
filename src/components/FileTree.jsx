import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContextMenu from './ContextMenu';

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
    try {
      const result = await window.nockTerminal.files.tree(rootPath);
      setTree(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error('FileTree: failed to load tree:', err);
      setTree([]);
    }
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

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const buildMenuItems = (node) => {
    const isFile = node.type === 'file';
    const items = [];

    if (isFile) {
      items.push({
        label: 'Open in Editor',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
        onClick: () => onFileClick(node.path),
      });
    }

    items.push({
      label: 'Open in Explorer',
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      ),
      onClick: () => {
        window.nockTerminal.shell.showItemInFolder?.(node.path);
      },
    });

    items.push({ separator: true });

    items.push({
      label: 'Copy Path',
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
        </svg>
      ),
      onClick: () => {
        window.nockTerminal.clipboard.write(node.path);
      },
    });

    if (isFile) {
      items.push({
        label: 'Copy Content',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
        onClick: async () => {
          try {
            const content = await window.nockTerminal.files.read(node.path);
            window.nockTerminal.clipboard.write(content || '');
          } catch (err) {
            console.error('Failed to copy file content:', err);
          }
        },
      });
    }

    return items;
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

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu.node)}
          onClose={closeContextMenu}
        />
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
