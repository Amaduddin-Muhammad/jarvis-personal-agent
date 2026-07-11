'use client';

import React, { useEffect, useState } from 'react';

interface StatusBarProps {
  voiceState: string;
}

export default function StatusBar({ voiceState }: StatusBarProps) {
  const [time, setTime] = useState('');
  const [battery, setBattery] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  // Read battery via Browser API if available
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((bat: any) => {
        setBattery(Math.round(bat.level * 100));
        setCharging(bat.charging);
        bat.addEventListener('levelchange', () => {
          setBattery(Math.round(bat.level * 100));
        });
        bat.addEventListener('chargingchange', () => {
          setCharging(bat.charging);
        });
      }).catch(() => {});
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--bg-1)',
        flexShrink: 0,
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="status-dot" />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: '0.16em',
            color: 'var(--text-hi)',
          }}
        >
          J.A.R.V.I.S
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--text-low)',
            marginLeft: 6,
            textTransform: 'uppercase',
          }}
        >
          {voiceState}
        </span>
      </div>

      {/* Right cluster */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-mid)',
          letterSpacing: '0.04em',
        }}
      >
        <span>{time}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="4" stroke="var(--glacier-400)" strokeWidth="1.2"/>
            <circle cx="5" cy="5" r="2" fill="var(--glacier-400)" opacity="0.6"/>
          </svg>
          Wi-Fi
        </span>
        {battery !== null && (
          <span style={{ color: battery < 20 ? 'var(--red-400)' : 'var(--text-mid)' }}>
            {charging ? '⚡ ' : ''}{battery}%
          </span>
        )}
      </div>
    </div>
  );
}
