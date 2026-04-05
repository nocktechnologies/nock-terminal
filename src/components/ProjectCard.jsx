import React from 'react';
import { statusColors, statusLabels } from '../utils/themes';

export default function ProjectCard({ session, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-nock-card border border-nock-border rounded-lg p-4 hover:border-nock-accent-blue/40 hover:bg-[#16161D] transition-all group cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-nock-text group-hover:text-white transition-colors truncate pr-2">
          {session.name}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${session.status === 'active' ? 'status-dot-active' : ''}`}
            style={{ backgroundColor: statusColors[session.status] }}
          />
          <span className="text-[10px] text-nock-text-dim">
            {statusLabels[session.status]}
          </span>
        </div>
      </div>

      {/* Branch */}
      {session.branch && (
        <div className="flex items-center gap-1.5 mb-2">
          <svg className="w-3 h-3 text-nock-text-dim shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <span className="text-xs text-nock-accent-blue font-mono truncate">{session.branch}</span>
          {session.dirty && (
            <span className="text-[10px] text-nock-yellow font-medium">modified</span>
          )}
        </div>
      )}

      {/* Path */}
      <p className="text-[10px] text-nock-text-dim/60 font-mono truncate mb-2">
        {session.path}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-nock-text-dim">
          {session.lastActivityFormatted}
        </span>
        <span className="text-[10px] text-nock-accent-blue opacity-0 group-hover:opacity-100 transition-opacity">
          Open Terminal →
        </span>
      </div>
    </button>
  );
}
