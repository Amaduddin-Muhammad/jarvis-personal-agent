'use client';

import React, { useEffect, useRef } from 'react';

interface ActivityEntry {
  id: string;
  time: string;
  text: string;
  level?: 'OK' | 'WARN' | 'ERROR' | 'SYS' | 'MIC';
}

interface ActivityPanelProps {
  entries: ActivityEntry[];
}

const LEVEL_COLORS: Record<string, string> = {
  OK:    'var(--glacier-400)',
  WARN:  'var(--amber-400)',
  ERROR: 'var(--red-400)',
  SYS:   'var(--text-low)',
  MIC:   'var(--amber-600)',
};

export default function ActivityPanel({ entries }: ActivityPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div
      style={{
        padding: '20px',
        borderLeft: '1px solid var(--hairline)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div className="panel-label">Activity</div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 && (
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-low)',
              marginTop: 8,
            }}
          >
            No activity yet.
          </p>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {[...entries].reverse().map((entry) => (
            <li key={entry.id} className="log-item">
              <span className="log-time">
                {entry.time}
                {entry.level && (
                  <span
                    style={{
                      marginLeft: 6,
                      color: LEVEL_COLORS[entry.level] ?? 'var(--text-low)',
                      fontWeight: 500,
                    }}
                  >
                    [{entry.level}]
                  </span>
                )}
              </span>
              <span className="log-text">{entry.text}</span>
            </li>
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
