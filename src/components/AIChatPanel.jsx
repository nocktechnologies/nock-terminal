import React, { useState, useRef, useEffect, useCallback } from 'react';
import ChatMessage from './ChatMessage';

const MODELS = [
  { id: 'gemma3:12b', label: 'Gemma 3 12B', backend: 'ollama' },
  { id: 'gemma3:27b', label: 'Gemma 3 27B', backend: 'ollama' },
  { id: 'gemma4', label: 'Gemma 4', backend: 'ollama' },
  { id: 'kit', label: 'Kit', backend: 'claude' },
  { id: 'mara', label: 'Mara', backend: 'claude' },
];

export default function AIChatPanel({ onClose, activeSession }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState(null); // null = checking, true = connected, false = disconnected
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Check Ollama status on mount
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for streaming chunks
  useEffect(() => {
    const cleanup = window.nockTerminal.ai.onStream((chunk) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
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

    // Add user message
    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    // Add placeholder assistant message
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true, model: model.label }]);

    try {
      if (model.backend === 'ollama') {
        const chatMessages = [...messages, userMsg].map(m => ({
          role: m.role,
          content: m.content,
        }));
        await window.nockTerminal.ai.ollama.chat(model.id, chatMessages);
      } else {
        // Claude Code (Kit or Mara)
        const cwd = activeSession?.cwd || process.cwd?.() || 'C:\\Users\\kkwil';
        await window.nockTerminal.ai.claude.chat(text, model.id, cwd);
      }
    } catch (err) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content || `Error: ${err.message}`, streaming: false, error: true },
          ];
        }
        return prev;
      });
    }

    // Mark streaming as done
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.streaming) {
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      }
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
    <div className="w-96 bg-nock-bg border-l border-nock-border flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nock-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold nock-gradient-text">AI Chat</span>
          {/* Connection status */}
          {isOllamaModel && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ollamaStatus === true ? 'bg-nock-green' :
                ollamaStatus === false ? 'bg-nock-red' :
                'bg-nock-yellow'
              }`}
              title={ollamaStatus ? 'Ollama connected' : 'Ollama disconnected'}
            />
          )}
        </div>
        <button
          onClick={onClose}
          className="text-nock-text-dim hover:text-nock-text transition-colors"
          title="Close (Ctrl+Shift+A)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Model selector */}
      <div className="px-3 py-2 border-b border-nock-border shrink-0">
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full bg-nock-card border border-nock-border rounded px-2 py-1.5 text-xs text-nock-text focus:outline-none focus:border-nock-accent-blue"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.backend === 'ollama' ? 'Local GPU' : 'Claude Code'})
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-nock-text-dim text-xs mt-8">
            <p className="mb-2">Chat with your AI models</p>
            <p className="text-[10px] text-nock-text-dim/60">
              Ollama for local GPU inference, Kit & Mara via Claude Code
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-nock-border shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (Ctrl+Enter to send)"
            rows={3}
            className="w-full bg-nock-card border border-nock-border rounded-lg px-3 py-2 text-sm text-nock-text placeholder-nock-text-dim/50 resize-none focus:outline-none focus:border-nock-accent-blue"
            disabled={isStreaming}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="absolute bottom-2 right-2 w-7 h-7 rounded nock-gradient-bg flex items-center justify-center disabled:opacity-30 transition-opacity"
          >
            {isStreaming ? (
              <svg className="w-3.5 h-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-[10px] text-nock-text-dim/40 mt-1 text-right">
          {currentModel?.label} · {currentModel?.backend === 'ollama' ? 'Local' : 'Claude Code'}
        </p>
      </div>
    </div>
  );
}
