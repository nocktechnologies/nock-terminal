import React from 'react';

const STATUS_CONFIG = {
  active:   { dot: 'bg-nock-green',   label: 'LIVE',    glowClass: 'status-active',   text: 'text-nock-green' },
  recent:   { dot: 'bg-nock-yellow',  label: 'RECENT',  glowClass: 'status-recent',   text: 'text-nock-yellow' },
  inactive: { dot: 'bg-nock-text-muted', label: 'IDLE', glowClass: 'status-inactive', text: 'text-nock-text-muted' },
};

export default function ProjectCard({ session, index, onClick }) {
  const cfg = STATUS_CONFIG[session.status] || STATUS_CONFIG.inactive;

  return (
    <button
      onClick={onClick}
      className="group relative w-full text-left bg-nock-card border border-nock-border rounded-lg p-5 hover:border-nock-accent-blue/50 hover:bg-nock-card-hover hover:shadow-card-hover transition-all duration-300 cursor-pointer overflow-hidden"
    >
      {/* Hover gradient glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 0% 0%, rgba(59, 111, 212, 0.08), transparent 50%)',
        }}
      />

      {/* Top row: index + status */}
      <div className="relative flex items-center justify-between mb-3">
        <span className="font-mono text-[9px] text-nock-text-muted tracking-widest tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`status-dot ${cfg.glowClass} w-1.5 h-1.5 ${cfg.dot}`} />
          <span className={`font-mono text-[9px] tracking-widest ${cfg.text}`}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Project name */}
      <h3 className="relative font-display font-semibold text-[15px] text-nock-text group-hover:text-white transition-colors truncate mb-2.5 leading-tight">
        {session.name}
      </h3>

      {/* Branch line */}
      {session.branch ? (
        <div className="relative flex items-center gap-1.5 mb-2">
          <svg className="w-3 h-3 text-nock-accent-blue shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="6" cy="3" r="2" />
            <circle cx="6" cy="21" r="2" />
            <circle cx="18" cy="12" r="2" />
            <path d="M6 5v14M18 10V9a3 3 0 00-3-3H6" />
          </svg>
          <span className="font-mono text-[11px] text-nock-accent-blue truncate tracking-tight">
            {session.branch}
          </span>
          {session.dirty && (
            <span className="font-mono text-[9px] text-nock-accent-amber tracking-widest ml-auto">
              ●MOD
            </span>
          )}
        </div>
      ) : (
        <div className="relative mb-2 h-4" />
      )}

      {/* Path (monospace, dimmed) */}
      <p className="relative font-mono text-[10px] text-nock-text-muted truncate mb-4 tracking-tight">
        {session.path}
      </p>

      {/* Bottom row: timestamp + action hint */}
      <div className="relative flex items-center justify-between pt-2 border-t border-nock-border/60">
        <span className="font-mono text-[9px] text-nock-text-muted tracking-wider uppercase">
          {session.lastActivityFormatted}
        </span>
        <span className="font-mono text-[9px] text-nock-accent-purple tracking-wider uppercase opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          OPEN
          <svg className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </button>
  );
}
