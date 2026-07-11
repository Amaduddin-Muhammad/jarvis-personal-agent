'use client';

import React from 'react';
import RadialGauge from './RadialGauge';

interface SystemPanelProps {
  cpu: number;
  ram: number;
  battery: number;
  netUp: number;
  netDown: number;
}

function formatNet(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB/s`;
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(mb * 1024).toFixed(0)} KB/s`;
}

export default function SystemPanel({ cpu, ram, battery, netUp, netDown }: SystemPanelProps) {
  return (
    <div
      style={{
        padding: '20px',
        borderRight: '1px solid var(--hairline)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div className="panel-label">System</div>

      <RadialGauge value={cpu} color="var(--glacier-400)" label="CPU" />
      <RadialGauge value={ram} color="var(--amber-400)" label="Memory" />
      <RadialGauge value={battery} color="var(--glacier-400)" label="Battery" />

      <ul className="sys-list">
        <li>
          <span>Upload</span>
          <span>{formatNet(netUp)}</span>
        </li>
        <li>
          <span>Download</span>
          <span>{formatNet(netDown)}</span>
        </li>
        <li>
          <span>Mode</span>
          <span style={{ color: 'var(--amber-400)' }}>Standard</span>
        </li>
      </ul>
    </div>
  );
}
