'use client';

import React from 'react';
import IrisGauge, { VoiceState } from './IrisGauge';
import ConfirmationStrip from './ConfirmationStrip';

interface VoicePanelProps {
  voiceState: VoiceState;
  amplitude: number;
  transcript: string;
  response: string;
  pendingConfirmation: { id: string; tool: string; scope: string; rationale: string } | null;
  onConfirm: (id: string, approved: boolean) => void;
}

export default function VoicePanel({
  voiceState,
  amplitude,
  transcript,
  response,
  pendingConfirmation,
  onConfirm,
}: VoicePanelProps) {
  // Show live transcript while listening, response while speaking, else empty
  const displayText =
    voiceState === 'listening'
      ? transcript
      : voiceState === 'speaking'
      ? response
      : '';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 24px',
        flex: 1,
        minWidth: 0,
        gap: 0,
      }}
    >
      <IrisGauge voiceState={voiceState} amplitude={amplitude} />

      {/* Live text line below iris */}
      {displayText && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--text-mid)',
            textAlign: 'center',
            marginTop: 12,
            maxWidth: 320,
            lineHeight: 1.5,
            fontStyle: 'italic',
            wordBreak: 'break-word',
          }}
        >
          &ldquo;{displayText}&rdquo;
        </div>
      )}

      {/* Confirmation strip — slides in when pending */}
      {pendingConfirmation && (
        <div style={{ width: '100%', maxWidth: 380, marginTop: 4 }}>
          <ConfirmationStrip
            tool={pendingConfirmation.tool}
            scope={pendingConfirmation.scope}
            rationale={pendingConfirmation.rationale}
            onConfirm={() => onConfirm(pendingConfirmation.id, true)}
            onCancel={() => onConfirm(pendingConfirmation.id, false)}
          />
        </div>
      )}
    </div>
  );
}
