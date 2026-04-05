import React, { useMemo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// Configure marked with highlight.js
marked.setOptions({
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        // Fall through
      }
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

export default function ChatMessage({ message }) {
  const { role, content, streaming, model, error } = message;
  const isUser = role === 'user';

  const html = useMemo(() => {
    if (!content) return '';
    try {
      return DOMPurify.sanitize(marked.parse(content));
    } catch {
      // Fallback: escape content as plain text, never inject raw
      return DOMPurify.sanitize(String(content));
    }
  }, [content]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-nock-accent-blue/20 border border-nock-accent-blue/30'
            : error
              ? 'bg-nock-red/10 border border-nock-red/30'
              : 'bg-nock-card border border-nock-border'
        }`}
      >
        {/* Model label for assistant messages */}
        {!isUser && model && (
          <p className="text-[10px] text-nock-accent-purple font-medium mb-1">{model}</p>
        )}

        {/* Content */}
        {isUser ? (
          <p className="text-sm text-nock-text whitespace-pre-wrap">{content}</p>
        ) : (
          <div
            className="chat-message text-sm text-nock-text prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {/* Streaming indicator */}
        {streaming && (
          <span className="inline-block w-1.5 h-4 bg-nock-accent-purple animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}
