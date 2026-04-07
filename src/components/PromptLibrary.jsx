import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Play, Trash2, Tag } from 'lucide-react';

export default function PromptLibrary({ onExecutePrompt }) {
  const [prompts, setPrompts] = useState([]);
  const [selected, setSelected] = useState(null);
  const saveTimerRef = useRef(null);

  const refreshList = useCallback(async () => {
    try {
      const list = await window.nockTerminal.prompts.list();
      setPrompts(list);
    } catch (err) {
      console.error('Failed to load prompts:', err);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const createPrompt = useCallback(async () => {
    try {
      const result = await window.nockTerminal.prompts.save(null, {
        title: 'New Prompt',
        tags: [],
        body: '',
      });
      if (result.success) {
        const prompt = await window.nockTerminal.prompts.get(result.id);
        if (prompt) {
          setSelected(prompt);
        }
        refreshList();
      }
    } catch (err) {
      console.error('Failed to create prompt:', err);
    }
  }, [refreshList]);

  const openPrompt = useCallback(async (prompt) => {
    try {
      const full = await window.nockTerminal.prompts.get(prompt.id);
      setSelected(full || prompt);
    } catch (err) {
      console.error('Failed to load prompt:', err);
      setSelected(prompt);
    }
  }, []);

  const goBack = useCallback(() => {
    setSelected(null);
    refreshList();
  }, [refreshList]);

  const autoSave = useCallback((updatedPrompt) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(async () => {
      try {
        await window.nockTerminal.prompts.save(updatedPrompt.id, {
          title: updatedPrompt.title,
          tags: updatedPrompt.tags,
          body: updatedPrompt.body,
        });
      } catch (err) {
        console.error('Failed to auto-save prompt:', err);
      }
    }, 400);
  }, []);

  const updateField = useCallback((field, value) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      autoSave(updated);
      return updated;
    });
  }, [autoSave]);

  const deletePrompt = useCallback(async () => {
    if (!selected) return;
    try {
      await window.nockTerminal.prompts.delete(selected.id);
      setSelected(null);
      refreshList();
    } catch (err) {
      console.error('Failed to delete prompt:', err);
    }
  }, [selected, refreshList]);

  const executePrompt = useCallback(() => {
    if (!selected || !onExecutePrompt) return;
    onExecutePrompt(selected.body);
  }, [selected, onExecutePrompt]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Detail view
  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <button
            onClick={goBack}
            className="text-[10px] text-nock-text-muted hover:text-nock-text transition-colors font-mono flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={executePrompt}
              className="text-nock-green hover:text-green-400 transition-colors"
              title="Execute prompt"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={deletePrompt}
              className="text-nock-text-muted hover:text-red-400 transition-colors"
              title="Delete prompt"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-3 pb-2 space-y-1.5">
          <input
            type="text"
            value={selected.title || ''}
            onChange={(e) => updateField('title', e.target.value)}
            className="w-full bg-transparent text-nock-text font-mono text-[12px] font-medium outline-none border-none placeholder-nock-text-muted"
            placeholder="Prompt title..."
          />
          <div className="flex items-center gap-1">
            <Tag className="w-2.5 h-2.5 text-nock-text-muted shrink-0" />
            <input
              type="text"
              value={Array.isArray(selected.tags) ? selected.tags.join(', ') : ''}
              onChange={(e) =>
                updateField(
                  'tags',
                  e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                )
              }
              className="w-full bg-transparent text-nock-text-muted font-mono text-[10px] outline-none border-none placeholder-nock-text-muted"
              placeholder="tags, comma, separated"
            />
          </div>
        </div>

        <div className="flex-1 px-3 pb-2 min-h-0">
          <textarea
            value={selected.body || ''}
            onChange={(e) => updateField('body', e.target.value)}
            className="w-full h-full bg-nock-card text-nock-text font-mono text-[11px] outline-none border border-nock-border rounded p-2 resize-none leading-relaxed placeholder-nock-text-muted"
            placeholder="Write your prompt here..."
          />
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest">
          // Prompts
        </span>
        <button
          onClick={createPrompt}
          className="text-nock-text-muted hover:text-nock-text transition-colors"
          title="New prompt"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {prompts.length === 0 ? (
          <p className="font-mono text-[10px] text-nock-text-muted px-1 py-2">No saved prompts</p>
        ) : (
          <div className="space-y-0.5">
            {prompts.map((prompt) => (
              <button
                key={prompt.id}
                onClick={() => openPrompt(prompt)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors group"
              >
                <p className="font-mono text-[10px] text-nock-text group-hover:text-white transition-colors truncate">
                  {prompt.title || 'Untitled'}
                </p>
                {prompt.tags && prompt.tags.length > 0 && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Tag className="w-2 h-2 text-nock-text-muted shrink-0" />
                    <p className="font-mono text-[8px] text-nock-text-muted truncate">
                      {prompt.tags.join(', ')}
                    </p>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
