'use client';

import React, { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';

interface StatusBarProps {
  voiceState: string;
}

export default function StatusBar({ voiceState }: StatusBarProps) {
  const [time, setTime] = useState('');
  const [battery, setBattery] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [isElectron, setIsElectron] = useState(false);

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

  // Detect Electron environment
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      setIsElectron(true);
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 20px',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--bg-1)',
        flexShrink: 0,
        // Make the frameless window draggable via status bar
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Brand */}
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8,
          // Prevent drag on children to keep click actions responsive
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
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
          // Prevent drag on children
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
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

        {/* Custom Windows Window Controls */}
        {isElectron && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 8, alignItems: 'center' }}>
            <button
              onClick={() => (window as any).electronAPI?.minimize()}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-mid)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '3px',
                transition: 'background 0.2s, color 0.2s',
              }}
              className="hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
              title="Minimize"
              aria-label="Minimize Window"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={() => (window as any).electronAPI?.maximize()}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-mid)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '3px',
                transition: 'background 0.2s, color 0.2s',
              }}
              className="hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
              title="Maximize / Restore"
              aria-label="Maximize Window"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => (window as any).electronAPI?.close()}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-mid)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '3px',
                transition: 'background 0.2s, color 0.2s',
              }}
              className="hover:bg-[rgba(193,80,63,0.2)] hover:text-[#ff4d4d]"
              title="Close to Tray"
              aria-label="Close Window"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
