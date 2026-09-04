export function normalizeTreeEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).map(entry => {
    if (entry?.type !== 'dir') return entry;
    return {
      ...entry,
      children: normalizeTreeEntries(entry.children || []),
      childrenLoaded: Boolean(entry.childrenLoaded),
      loadingChildren: Boolean(entry.loadingChildren),
    };
  });
}

export function replaceTreeNodeChildren(nodes = [], targetPath, children = [], extra = {}) {
  return nodes.map(node => {
    if (node?.type !== 'dir') return node;
    if (node.path === targetPath) {
      return {
        ...node,
        ...extra,
        children: normalizeTreeEntries(children),
        childrenLoaded: true,
        loadingChildren: false,
      };
    }
    return {
      ...node,
      children: replaceTreeNodeChildren(node.children || [], targetPath, children, extra),
    };
  });
}

export function updateTreeNode(nodes = [], targetPath, patch = {}) {
  return nodes.map(node => {
    if (node?.type !== 'dir') return node;
    if (node.path === targetPath) return { ...node, ...patch };
    return {
      ...node,
      children: updateTreeNode(node.children || [], targetPath, patch),
    };
  });
}
