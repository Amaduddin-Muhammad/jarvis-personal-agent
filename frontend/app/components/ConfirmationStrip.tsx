'use client';

import React from 'react';

interface ConfirmationStripProps {
  tool: string;
  scope: string;
  rationale: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationStrip({
  tool,
  scope,
  rationale,
  onConfirm,
  onCancel,
}: ConfirmationStripProps) {
  return (
    <div
      className="confirm-strip"
      style={{ marginTop: 16, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--red-400)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 1L9 9H1L5 1Z" stroke="var(--red-400)" strokeWidth="1" fill="none"/>
          <line x1="5" y1="4" x2="5" y2="6.5" stroke="var(--red-400)" strokeWidth="1" strokeLinecap="round"/>
          <circle cx="5" cy="7.5" r="0.5" fill="var(--red-400)"/>
        </svg>
        Authorization Required
      </div>

      {/* Tool + Scope */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--amber-50)' }}>
        <span style={{ color: 'var(--text-low)' }}>Tool: </span>
        <span style={{ color: 'var(--amber-400)' }}>{tool}</span>
        {scope && (
          <>
            <span style={{ color: 'var(--text-low)', marginLeft: 12 }}>Scope: </span>
            <span>{scope}</span>
          </>
        )}
      </div>

      {/* Rationale */}
      {rationale && (
        <div style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.4 }}>
          {rationale}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="confirm-yes" onClick={onConfirm} aria-label="Confirm action">
          Confirm
        </button>
        <button className="confirm-no" onClick={onCancel} aria-label="Cancel action">
          Cancel
        </button>
      </div>
    </div>
  );
}
