'use client';

import React, { useEffect, useRef, useMemo } from 'react';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'confirming' | 'speaking' | 'error';

interface IrisGaugeProps {
  voiceState: VoiceState;
  amplitude: number; // 0–1
}

const BAR_COUNT = 48;
const CX = 110;
const CY = 110;
const INNER_R = 70;
const MAX_BAR_EXTENSION = 18;

// Color per state
const STATE_COLORS: Record<VoiceState, string> = {
  idle:       '#6FA8C9',
  listening:  '#D98F4A',
  thinking:   'rgba(217, 143, 74, 0.45)',
  confirming: '#C1503F',
  speaking:   '#D98F4A',
  error:      '#C1503F',
};

const STATE_LABELS: Record<VoiceState, string> = {
  idle:       'Say "Jarvis" to begin',
  listening:  'Listening…',
  thinking:   'Parsing request…',
  confirming: 'Awaiting confirmation',
  speaking:   'Speaking…',
  error:      'Error — try again',
};

// Pre-compute bar angles
const ANGLES = Array.from({ length: BAR_COUNT }, (_, i) => (i / BAR_COUNT) * Math.PI * 2);

export default function IrisGauge({ voiceState, amplitude }: IrisGaugeProps) {
  const barsRef = useRef<SVGLineElement[]>([]);
  const rafRef  = useRef<number | null>(null);
  const stateRef = useRef<VoiceState>(voiceState);
  const ampRef  = useRef<number>(amplitude);
  const rotRef  = useRef<number>(0);

  // Keep refs in sync with props without re-creating animation loop
  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { ampRef.current = amplitude; }, [amplitude]);

  // Reduce motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const color = STATE_COLORS[voiceState];

  // Animation loop (runs once, reads from refs)
  useEffect(() => {
    if (prefersReducedMotion) return;

    let lastTime = 0;

    const animate = (timestamp: number) => {
      const dt = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      const state = stateRef.current;
      const amp   = ampRef.current;

      // Rotate bars in thinking state
      if (state === 'thinking') {
        rotRef.current = (rotRef.current + dt * 45) % 360;
      } else {
        rotRef.current = 0;
      }

      barsRef.current.forEach((bar, i) => {
        if (!bar) return;

        const baseAngle = ANGLES[i];
        const rotRad = (rotRef.current * Math.PI) / 180;
        const angle = baseAngle + rotRad;

        let extension = 0;
        let opacity = 0.35;

        if (state === 'idle') {
          // Gentle breathing — sin wave per bar with offset
          const t = timestamp / 3500;
          extension = Math.max(0, Math.sin(t + i * 0.13) * 3);
          opacity = 0.3 + Math.abs(Math.sin(t * 0.5)) * 0.25;
        } else if (state === 'listening' || state === 'speaking') {
          // Pulse proportional to amplitude with per-bar wobble
          const wobble = Math.sin(timestamp / 180 + i * 0.26) * amp;
          extension = Math.max(0, wobble) * MAX_BAR_EXTENSION;
          opacity = 0.35 + Math.max(0, wobble) * 0.65;
        } else if (state === 'thinking') {
          // Uniform low-level shimmer while rotating
          extension = 3 + Math.sin(timestamp / 400 + i * 0.4) * 2;
          opacity = 0.25 + Math.sin(timestamp / 600 + i * 0.2) * 0.15;
        } else if (state === 'confirming' || state === 'error') {
          // Static minimal bars
          extension = 2;
          opacity = 0.4;
        }

        const r1 = INNER_R;
        const r2 = INNER_R + 8 + extension;
        const x1 = CX + Math.cos(angle) * r1;
        const y1 = CY + Math.sin(angle) * r1;
        const x2 = CX + Math.cos(angle) * r2;
        const y2 = CY + Math.sin(angle) * r2;

        bar.setAttribute('x1', String(x1));
        bar.setAttribute('y1', String(y1));
        bar.setAttribute('x2', String(x2));
        bar.setAttribute('y2', String(y2));
        bar.setAttribute('opacity', String(Math.min(1, Math.max(0, opacity))));
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [prefersReducedMotion]);

  // Reduced-motion: draw static bars
  const staticBars = useMemo(() => {
    if (!prefersReducedMotion) return null;
    return ANGLES.map((angle, i) => {
      const x1 = CX + Math.cos(angle) * INNER_R;
      const y1 = CY + Math.sin(angle) * INNER_R;
      const x2 = CX + Math.cos(angle) * (INNER_R + 8);
      const y2 = CY + Math.sin(angle) * (INNER_R + 8);
      return (
        <line
          key={i}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.5"
        />
      );
    });
  }, [prefersReducedMotion, color]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        viewBox="0 0 220 220"
        width="200"
        height="200"
        aria-label={`JARVIS voice status: ${voiceState}`}
        role="img"
      >
        {/* Outer rings */}
        <circle cx={CX} cy={CY} r="98" fill="none" stroke="var(--bg-2)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r="86" fill="none" stroke="var(--hairline)" strokeWidth="1" />

        {/* Bars (animated via ref) */}
        {prefersReducedMotion ? (
          staticBars
        ) : (
          ANGLES.map((_, i) => (
            <line
              key={i}
              ref={(el) => { if (el) barsRef.current[i] = el; }}
              x1={CX} y1={CY}
              x2={CX} y2={CY}
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.35"
              style={{ transition: 'stroke 0.4s ease' }}
            />
          ))
        )}

        {/* Center disc */}
        <circle
          cx={CX}
          cy={CY}
          r="58"
          fill="var(--bg-1)"
          stroke={color}
          strokeWidth="1.5"
          style={{ transition: 'stroke 0.4s ease' }}
        />

        {/* Center label */}
        <text
          x={CX}
          y={CY + 5}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fill="var(--text-mid)"
          letterSpacing="2"
        >
          JARVIS
        </text>

        {/* Reduced-motion amplitude readout */}
        {prefersReducedMotion && (
          <text
            x={CX}
            y={CY + 20}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="9"
            fill="var(--text-low)"
          >
            {Math.round(amplitude * 100)}
          </text>
        )}
      </svg>

      {/* State label */}
      <div className={`voice-state-label ${voiceState}`}>
        {voiceState.toUpperCase()}
      </div>

      {/* Hint text */}
      <div className="voice-transcript">
        {STATE_LABELS[voiceState]}
      </div>
    </div>
  );
}
