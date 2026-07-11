'use client';

import React from 'react';

interface QuickAction {
  label: string;
  command: string;
  icon?: string;
}

const DEFAULT_ACTIONS: QuickAction[] = [
  { label: 'Open app',        command: 'open ',      icon: '⬡' },
  { label: 'Search files',    command: 'find files ', icon: '◈' },
  { label: 'Read email',      command: 'read my emails', icon: '✉' },
  { label: 'Screenshot',      command: 'take a screenshot', icon: '⬚' },
  { label: 'Run script…',     command: 'run script ', icon: '▷' },
  { label: 'System status',   command: 'show system status', icon: '◎' },
  { label: 'Clipboard',       command: 'read clipboard', icon: '⎘' },
];

interface QuickActionsBarProps {
  onAction: (command: string) => void;
}

export default function QuickActionsBar({ onAction }: QuickActionsBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 20px',
        borderTop: '1px solid var(--hairline)',
        flexWrap: 'wrap',
        background: 'var(--bg-1)',
        flexShrink: 0,
      }}
    >
      {DEFAULT_ACTIONS.map((action) => (
        <button
          key={action.label}
          className="chip"
          onClick={() => onAction(action.command)}
          title={action.command}
          aria-label={`Quick action: ${action.label}`}
        >
          {action.icon && (
            <span style={{ marginRight: 5, opacity: 0.7, fontStyle: 'normal' }}>
              {action.icon}
            </span>
          )}
          {action.label}
        </button>
      ))}
    </div>
  );
}
