import React from 'react';
import ProjectCard from './ProjectCard';

export default function Dashboard({ sessions, onSessionClick, onNewTerminal, onRefresh }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold nock-gradient-text">Sessions</h1>
          <p className="text-sm text-nock-text-dim mt-1">
            {sessions.length} project{sessions.length !== 1 ? 's' : ''} discovered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 text-xs border border-nock-border rounded hover:bg-nock-card transition-colors text-nock-text-dim hover:text-nock-text"
          >
            Refresh
          </button>
          <button
            onClick={() => onNewTerminal()}
            className="px-3 py-1.5 text-xs nock-gradient-bg rounded text-white font-medium hover:opacity-90 transition-opacity"
          >
            New Terminal
          </button>
        </div>
      </div>

      {/* Grid */}
      {sessions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sessions.map((session) => (
            <ProjectCard
              key={session.id}
              session={session}
              onClick={() => onSessionClick(session)}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-nock-card border border-nock-border flex items-center justify-center">
              <svg className="w-8 h-8 text-nock-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-nock-text-dim mb-2">No Claude Code sessions found</p>
            <p className="text-xs text-nock-text-dim/60">
              Sessions will appear here when you use Claude Code in your projects
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
