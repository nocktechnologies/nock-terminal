import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContextMenu from './ContextMenu';
import { formatTreeMetaNotice } from '../utils/fileTreeMeta.mjs';
import { normalizeTreeEntries, replaceTreeNodeChildren, updateTreeNode } from '../utils/fileTreeState.mjs';

const ROOT_TREE_OPTIONS = { maxDepth: 1, maxEntries: 300 };
const CHILD_TREE_OPTIONS = { maxDepth: 1, maxEntries: 300 };

const GIT_STATUS_COLORS = {
  M: 'bg-nock-yellow',
  A: 'bg-nock-green',
  D: 'bg-red-400',
  '?': 'bg-nock-text-muted',
  '??': 'bg-nock-text-muted',
};

export default function FileTree({ rootPath, onFileClick, onCtrlPFocus }) {
  const [tree, setTree] = useState([]);
  const [treeMeta, setTreeMeta] = useState(null);
  const [gitStatus, setGitStatus] = useState({});
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const filterRef = useRef(null);

  const loadTree = useCallback(async () => {
    if (!rootPath) return;
    try {
      const result = await window.nockTerminal.files.tree(rootPath, ROOT_TREE_OPTIONS);
      if (Array.isArray(result)) {
        setTree(normalizeTreeEntries(result));
        setTreeMeta(null);
      } else {
        setTree(normalizeTreeEntries(result?.entries));
        setTreeMeta(result?.meta || null);
      }
    } catch (err) {
      console.error('FileTree: failed to load tree:', err);
      setTree([]);
      setTreeMeta({ error: err.message });
    }
  }, [rootPath]);

  const loadChildren = useCallback(async (dirPath) => {
    setTree(prev => updateTreeNode(prev, dirPath, { loadingChildren: true }));
    try {
      const result = await window.nockTerminal.files.tree(dirPath, CHILD_TREE_OPTIONS);
      const entries = Array.isArray(result) ? result : result?.entries;
      setTree(prev => replaceTreeNodeChildren(prev, dirPath, entries, {
        childrenMeta: Array.isArray(result) ? null : result?.meta || null,
      }));
    } catch (err) {
      console.error('FileTree: failed to load children:', err);
      setTree(prev => updateTreeNode(prev, dirPath, {
        childrenLoaded: true,
        loadingChildren: false,
        childrenMeta: { error: err.message },
      }));
    }
  }, []);

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
            const result = await window.nockTerminal.files.read(node.path);
            if (typeof result?.content === 'string') {
              window.nockTerminal.clipboard.write(result.content);
            }
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
  const treeMetaNotice = formatTreeMetaNotice(treeMeta, 'tree');

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

      {treeMetaNotice && (
        <div className="mx-2 mb-2 rounded border border-nock-yellow/20 bg-nock-yellow/10 px-2 py-1 text-[10px] font-mono text-nock-yellow">
          {treeMetaNotice}
        </div>
      )}

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
            onLoadChildren={loadChildren}
            forceExpand={Boolean(filter)}
          />
        ))}
        {filter && filteredTree.length === 0 && (
          <p className="font-mono text-[10px] text-nock-text-muted px-2 py-1">No files match</p>
        )}
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

function TreeNode({ node, depth, gitStatus, rootPath, onFileClick, onContextMenu, onLoadChildren, forceExpand = false }) {
  const [expanded, setExpanded] = useState(false);

  const relativePath = node.path.replace(rootPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
  const statusCode = gitStatus[relativePath] || gitStatus[relativePath.replace(/\//g, '\\')];
  const childrenMetaNotice = formatTreeMetaNotice(node.childrenMeta, 'folder');

  if (node.type === 'dir') {
    // While a filter is active every surviving folder opens, so matches deep
    // in the tree are visible instead of hiding behind collapsed parents.
    const isOpen = forceExpand || expanded;
    const toggleOpen = () => {
      const nextOpen = !isOpen;
      setExpanded(nextOpen);
      if (nextOpen && !node.childrenLoaded && !node.loadingChildren) {
        onLoadChildren(node.path);
      }
    };
    return (
      <div>
        <button
          type="button"
          onClick={toggleOpen}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="w-full min-h-6 text-left flex items-center gap-1 py-0.5 hover:bg-nock-card/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
        >
          <span className="text-[10px] text-nock-accent-blue w-3 shrink-0">
            {isOpen ? '▾' : '▸'}
          </span>
          <span className="text-[10px] text-nock-accent-blue truncate">{node.name}/</span>
        </button>
        {isOpen && node.loadingChildren && (
          <p
            className="font-mono text-[10px] text-nock-text-muted py-0.5"
            style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
          >
            Loading...
          </p>
        )}
        {isOpen && childrenMetaNotice && (
          <p
            className="font-mono text-[10px] text-nock-yellow py-0.5"
            style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
          >
            {childrenMetaNotice}
          </p>
        )}
        {isOpen && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            gitStatus={gitStatus}
            rootPath={rootPath}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
            onLoadChildren={onLoadChildren}
            forceExpand={forceExpand}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onFileClick(node.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
      className="w-full min-h-6 text-left flex items-center gap-1.5 py-0.5 hover:bg-nock-card/50 rounded transition-colors"
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
      aria-label={`Open ${node.name}`}
    >
      <span className="text-[10px] text-nock-text truncate">{node.name}</span>
      {statusCode && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${GIT_STATUS_COLORS[statusCode] || 'bg-nock-text-muted'}`} />
      )}
    </button>
  );
}
