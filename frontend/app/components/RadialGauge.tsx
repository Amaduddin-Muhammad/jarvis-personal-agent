'use client';

import React from 'react';

interface RadialGaugeProps {
  metric: string;
  value: number;        // 0–100
  color?: string;       // CSS color
  label: string;
}

export default function RadialGauge({
  metric,
  value,
  color = 'var(--glacier-400)',
  label,
}: RadialGaugeProps) {
  const r = 19;
  const circumference = 2 * Math.PI * r; // ≈ 119.4
  const clamped = Math.max(0, Math.min(100, value));
  // dashoffset: full = circumference (empty arc), 0 = full arc
  const dashOffset = circumference * (1 - clamped / 100);

  // Color shifts to amber at >70%, red at >90%
  const resolvedColor =
    clamped > 90
      ? 'var(--red-400)'
      : clamped > 70
      ? 'var(--amber-400)'
      : color;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <svg
        width="46"
        height="46"
        viewBox="0 0 46 46"
        aria-label={`${label}: ${Math.round(clamped)}%`}
        role="img"
      >
        {/* Track */}
        <circle
          cx="23"
          cy="23"
          r={r}
          fill="none"
          stroke="var(--hairline)"
          strokeWidth="3.5"
        />
        {/* Fill */}
        <circle
          cx="23"
          cy="23"
          r={r}
          fill="none"
          stroke={resolvedColor}
          strokeWidth="3.5"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 23 23)"
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
      </svg>
      <div className="gauge-meta">
        <span className="gauge-val">{Math.round(clamped)}%</span>
        {label}
      </div>
    </div>
  );
}
