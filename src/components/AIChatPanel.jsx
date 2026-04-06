import React, { useState, useRef, useEffect, useCallback } from 'react';
import ChatMessage from './ChatMessage';

const MODELS = [
  { id: 'gemma3:12b', label: 'G3·12B', full: 'Gemma 3 12B', backend: 'ollama' },
  { id: 'gemma3:27b', label: 'G3·27B', full: 'Gemma 3 27B', backend: 'ollama' },
  { id: 'gemma4',     label: 'G4',     full: 'Gemma 4',     backend: 'ollama' },
  { id: 'kit',        label: 'KIT',    full: 'Kit',         backend: 'claude' },
  { id: 'mara',       label: 'MARA',   full: 'Mara',        backend: 'claude' },
];

export default function AIChatPanel({ onClose, activeSession }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const check = async () => {
      try {
        const status = await window.nockTerminal.ai.ollama.status();
        setOllamaStatus(status.connected);
      } catch {
        setOllamaStatus(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    const model = MODELS.find(m => m.id === selectedModel);
    if (!model) return;

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true, model: model.full }]);

    try {
      if (model.backend === 'ollama') {
        const chatMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
        await window.nockTerminal.ai.ollama.chat(model.id, chatMessages);
      } else {
        const cwd = activeSession?.cwd || undefined; // main process falls back to process.cwd()
        await window.nockTerminal.ai.claude.chat(text, model.id, cwd);
      }
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
  }, [input, isStreaming, selectedModel, messages, activeSession]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentModel = MODELS.find(m => m.id === selectedModel);
  const isOllamaModel = currentModel?.backend === 'ollama';

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

      {/* Model selector — segmented pills */}
      <div className="px-3 py-2.5 border-b border-nock-border shrink-0">
        <div className="grid grid-cols-5 gap-1 p-1 bg-nock-card/60 rounded-md border border-nock-border">
          {MODELS.map((m) => {
            const active = selectedModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                className={`font-mono text-[9px] font-semibold py-1.5 rounded tracking-wider transition-all ${
                  active
                    ? 'bg-gradient-to-br from-nock-accent-blue to-nock-accent-purple text-white shadow-glow-blue'
                    : 'text-nock-text-muted hover:text-nock-text hover:bg-nock-card'
                }`}
                title={`${m.full} (${m.backend === 'ollama' ? 'local GPU' : 'Claude Code'})`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
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
              Currently: {currentModel?.full}
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
            disabled={!input.trim() || isStreaming}
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
                <kbd className="text-[8px] bg-white/15 border-white/10 px-1 py-0 text-white">⌃↵</kbd>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
