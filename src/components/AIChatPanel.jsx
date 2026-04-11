import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, RefreshCw, ExternalLink, Terminal } from 'lucide-react';
import ChatMessage from './ChatMessage';

function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export default function AIChatPanel({
  onClose,
  activeSession,
  onOpenTerminalWithClaude,
  queuedPrompt,
  onQueuedPromptHandled,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState(null);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const messagesRef = useRef([]);
  const activeQueuedPromptIdRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load saved model preference on mount
  useEffect(() => {
    const loadDefault = async () => {
      try {
        const saved = await window.nockTerminal.settings.get('defaultModel');
        if (saved) setSelectedModel(saved);
      } catch {
        // ignore — will pick first model after fetch
      }
    };
    loadDefault();
  }, []);

  // Fetch Ollama models and status
  const fetchModels = useCallback(async () => {
    try {
      const status = await window.nockTerminal.ai.ollama.status();
      setOllamaStatus(status?.connected === true);
      if (status?.connected) {
        const models = await window.nockTerminal.ai.ollama.models();
        setOllamaModels(models || []);
        if (!selectedModel && models && models.length > 0) {
          setSelectedModel(models[0].name);
        }
      } else {
        setOllamaModels([]);
      }
    } catch {
      setOllamaModels([]);
      setOllamaStatus(false);
    }
  }, [selectedModel]);

  useEffect(() => {
    fetchModels();
    const interval = setInterval(fetchModels, 30000);
    return () => clearInterval(interval);
  }, [fetchModels]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const cleanup = window.nockTerminal.ai.onStream((chunk) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        }
        return prev;
      });
    });
    return cleanup;
  }, []);

  const selectModel = useCallback((modelName) => {
    setSelectedModel(modelName);
    setDropdownOpen(false);
    try {
      window.nockTerminal.settings.set('defaultModel', modelName);
    } catch {
      // settings save is best-effort
    }
  }, []);

  const sendText = useCallback(async (rawText) => {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text || isStreaming || !selectedModel) return;

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true, model: selectedModel }]);

    try {
      const chatMessages = [...messagesRef.current, userMsg].map(m => ({ role: m.role, content: m.content }));
      await window.nockTerminal.ai.ollama.chat(selectedModel, chatMessages);
    } catch (err) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.streaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content || `Error: ${err.message}`, streaming: false, error: true }];
        }
        return prev;
      });
    }

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }];
      return prev;
    });
    setIsStreaming(false);
  }, [isStreaming, selectedModel]);

  const sendMessage = useCallback(async () => {
    await sendText(input);
  }, [input, sendText]);

  useEffect(() => {
    const queuedPromptId = queuedPrompt?.id;
    const queuedPromptText = typeof queuedPrompt?.text === 'string' ? queuedPrompt.text.trim() : '';
    if (!queuedPromptId || !queuedPromptText) return;

    inputRef.current?.focus();

    if (!selectedModel) {
      setInput(prev => prev || queuedPromptText);
      return;
    }

    if (isStreaming || activeQueuedPromptIdRef.current === queuedPromptId) {
      return;
    }

    activeQueuedPromptIdRef.current = queuedPromptId;
    sendText(queuedPromptText).finally(() => {
      if (activeQueuedPromptIdRef.current === queuedPromptId) {
        activeQueuedPromptIdRef.current = null;
      }
      onQueuedPromptHandled?.(queuedPromptId);
    });
  }, [isStreaming, onQueuedPromptHandled, queuedPrompt, selectedModel, sendText]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isOllamaModel = ollamaModels.some(m => m.name === selectedModel);
  const currentModelObj = ollamaModels.find(m => m.name === selectedModel);

  return (
    <div className="w-[400px] bg-nock-bg border-l border-nock-border flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-nock-border shrink-0 relative">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-nock-accent-purple/30 to-transparent" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-nock-accent-cyan tracking-widest uppercase">// 02</span>
            <span className="font-display font-semibold text-[13px] nock-gradient-text tracking-wide">AI Chat</span>
            {isOllamaModel && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  ollamaStatus === true ? 'bg-nock-green shadow-glow-green animate-pulse-glow' :
                  ollamaStatus === false ? 'bg-nock-red' :
                  'bg-nock-yellow'
                }`}
                title={ollamaStatus ? 'Ollama connected' : 'Ollama disconnected'}
              />
            )}
          </div>
          <button
            onClick={onClose}
            className="text-nock-text-muted hover:text-nock-text transition-colors"
            title="Close (Ctrl+Shift+A)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Model selector — dropdown */}
      <div className="px-3 py-2.5 border-b border-nock-border shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(prev => !prev)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-nock-card/60 rounded-md border border-nock-border hover:border-nock-accent-blue/40 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] font-semibold text-nock-text truncate">
              {selectedModel || 'Select model...'}
            </span>
            {currentModelObj && (
              <span className="font-mono text-[9px] text-nock-text-muted shrink-0">
                {formatSize(currentModelObj.size)}
              </span>
            )}
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-nock-text-muted shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="mt-1 bg-nock-card border border-nock-border rounded-lg shadow-xl overflow-hidden max-h-[320px] overflow-y-auto z-50">
            {/* Ollama models section */}
            {ollamaStatus === false ? (
              <div className="px-3 py-3 flex items-center justify-between">
                <span className="font-mono text-[10px] text-nock-red">Ollama offline</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchModels();
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono text-nock-text-muted hover:text-nock-accent-cyan border border-nock-border rounded transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              </div>
            ) : ollamaModels.length === 0 ? (
              <div className="px-3 py-3">
                <span className="font-mono text-[10px] text-nock-text-muted">No Ollama models found</span>
              </div>
            ) : (
              <>
                <div className="px-3 pt-2 pb-1">
                  <span className="font-mono text-[8px] text-nock-text-dim tracking-widest uppercase">Local Models</span>
                </div>
                {ollamaModels.map((model) => (
                  <button
                    key={model.name}
                    onClick={() => selectModel(model.name)}
                    className={`w-full text-left px-3 py-2 hover:bg-nock-border/30 transition-colors ${
                      selectedModel === model.name ? 'bg-nock-accent-blue/10 border-l-2 border-nock-accent-blue' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-nock-text">{model.name}</span>
                      <span className="font-mono text-[9px] text-nock-text-muted">{formatSize(model.size)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {model.parameterSize && (
                        <span className="font-mono text-[8px] text-nock-accent-cyan">{model.parameterSize}</span>
                      )}
                      {model.family && (
                        <span className="font-mono text-[8px] text-nock-text-dim">{model.family}</span>
                      )}
                      {model.quantization && (
                        <span className="font-mono text-[8px] text-nock-text-dim">{model.quantization}</span>
                      )}
                    </div>
                  </button>
                ))}
              </>
            )}

            {/* Divider */}
            <div className="border-t border-nock-border my-1" />

            {/* Kit — Claude Code */}
            <button
              onClick={() => {
                setDropdownOpen(false);
                if (onOpenTerminalWithClaude) {
                  onOpenTerminalWithClaude(activeSession?.cwd);
                }
              }}
              className="w-full text-left px-3 py-2 hover:bg-nock-border/30 transition-colors flex items-center gap-2"
            >
              <Terminal className="w-3.5 h-3.5 text-nock-accent-purple" />
              <div className="flex-1 min-w-0">
                <span className="font-mono text-[11px] font-semibold text-nock-accent-purple">Kit</span>
                <span className="font-mono text-[9px] text-nock-text-muted ml-2">Claude Code</span>
              </div>
            </button>

            {/* Mara — claude.ai */}
            <button
              onClick={() => {
                setDropdownOpen(false);
                try {
                  window.nockTerminal.shell.openExternal('https://claude.ai');
                } catch {
                  // best-effort
                }
              }}
              className="w-full text-left px-3 py-2 hover:bg-nock-border/30 transition-colors flex items-center gap-2"
            >
              <ExternalLink className="w-3.5 h-3.5 text-nock-accent-cyan" />
              <div className="flex-1 min-w-0">
                <span className="font-mono text-[11px] font-semibold text-nock-accent-cyan">Mara</span>
                <span className="font-mono text-[9px] text-nock-text-muted ml-2">claude.ai</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center mt-10">
            <div className="inline-block mb-3 p-3 rounded-full bg-nock-card border border-nock-border">
              <img src="./nock-logo.png" alt="" className="w-8 h-8 opacity-60" />
            </div>
            <p className="font-display text-[13px] text-nock-text mb-1">Ready for instructions</p>
            <p className="font-mono text-[9px] text-nock-text-muted tracking-wider uppercase">
              Currently: {selectedModel || 'No model selected'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => <ChatMessage key={i} message={msg} />)}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-nock-border shrink-0 bg-nock-bg-elevated/30">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
            rows={3}
            className="w-full bg-nock-card border border-nock-border rounded-lg px-3 py-2.5 text-sm text-nock-text placeholder-nock-text-muted resize-none focus:outline-none focus:border-nock-accent-blue focus:shadow-glow-blue transition-shadow"
            disabled={isStreaming}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming || !selectedModel}
            className="absolute bottom-2 right-2 h-7 px-3 rounded bg-gradient-to-br from-nock-accent-blue to-nock-accent-purple text-white font-mono text-[10px] font-semibold tracking-wider uppercase flex items-center gap-1.5 disabled:opacity-30 hover:shadow-glow-purple transition-shadow"
          >
            {isStreaming ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Streaming
              </>
            ) : (
              <>
                Send
                <kbd className="text-[8px] bg-white/15 border-white/10 px-1 py-0 text-white">Ctrl+Enter</kbd>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
