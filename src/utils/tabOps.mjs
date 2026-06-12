export function createTabId(prefix = 'tab') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function reorderTabList(tabs, dragId, targetId) {
  const arr = [...tabs];
  const dragIdx = arr.findIndex(t => t.id === dragId);
  const targetIdx = arr.findIndex(t => t.id === targetId);
  if (dragIdx === -1 || targetIdx === -1) return tabs;
  const [dragged] = arr.splice(dragIdx, 1);
  arr.splice(targetIdx, 0, dragged);
  return arr;
}

export function removeTabById(tabs, tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return tabs;
  return tabs.filter(t => t.id !== tabId);
}

export function nextActiveTabId(remainingTabs, closedTabId, currentActiveId) {
  if (currentActiveId !== closedTabId) return currentActiveId;
  if (remainingTabs.length === 0) return null;
  return remainingTabs[remainingTabs.length - 1].id;
}
