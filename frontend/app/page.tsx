'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, Mic, MicOff, Settings, Trash2, ExternalLink } from 'lucide-react';

import StatusBar from './components/StatusBar';
import SystemPanel from './components/SystemPanel';
import VoicePanel from './components/VoicePanel';
import ActivityPanel from './components/ActivityPanel';
import QuickActionsBar from './components/QuickActionsBar';
import { VoiceState } from './components/IrisGauge';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ChatMessage {
  id: string;
  sender: 'OWNER' | 'JARVIS';
  text: string;
  timestamp: string;
  isImage?: boolean;
  isDocument?: boolean;
  fileUrl?: string;
  filename?: string;
}

interface ActivityEntry {
  id: string;
  time: string;
  text: string;
  level?: 'OK' | 'WARN' | 'ERROR' | 'SYS' | 'MIC';
}

interface Vitals {
  cpu: number;
  ram: number;
  battery: number;
  netUp: number;
  netDown: number;
}

interface ConfirmGate {
  id: string;
  tool: string;
  scope: string;
  rationale: string;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  abort: () => void;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => ISpeechRecognition;
  webkitSpeechRecognition?: new () => ISpeechRecognition;
}

interface WindowWithAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface VitalsPayload {
  data?: {
    cpu?: number;
    ram?: number;
    battery?: number;
    network?: {
      sent_mb?: number;
      recv_kb?: number;
    };
  };
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function JarvisDashboard() {
  // Voice / agent state machine
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [amplitude, setAmplitude] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');

  // System vitals
  const [vitals, setVitals] = useState<Vitals>({ cpu: 12, ram: 45, battery: 100, netUp: 0.1, netDown: 1.2 });

  // Chat + activity
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  // Input / mic
  const [textInput, setTextInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);

  // Confirmation gate
  const [confirmGate, setConfirmGate] = useState<ConfirmGate | null>(null);

  // Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState('en-US');
  const [voiceSpeed, setVoiceSpeed] = useState(1.05);
  const [voicePitch, setVoicePitch] = useState(0.95);
  const [activeModel, setActiveModel] = useState('nvidia/nemotron-3-ultra-550b-a55b');
  const [temperature, setTemperature] = useState(0.7);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const recognitionRunningRef = useRef(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const isMicDuckedRef = useRef(false);
  const vadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isMutedRef = useRef(isMuted);
  const currentLangRef = useRef(currentLang);
  const voiceSpeedRef = useRef(voiceSpeed);
  const voicePitchRef = useRef(voicePitch);
  const shouldRestartRef = useRef(true);

  // Keep refs in sync
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { currentLangRef.current = currentLang; }, [currentLang]);
  useEffect(() => { voiceSpeedRef.current = voiceSpeed; }, [voiceSpeed]);
  useEffect(() => { voicePitchRef.current = voicePitch; }, [voicePitch]);

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────
  const pushActivity = useCallback((text: string, level?: ActivityEntry['level']) => {
    setActivityLog(prev => [
      ...prev.slice(-49),
      {
        id: Math.random().toString(36).slice(2),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        text,
        level,
      },
    ]);
  }, []);

  const addMessage = useCallback((sender: 'OWNER' | 'JARVIS', text: string) => {
    const isImage = text.includes('/output/images/');
    const isDocument = text.includes('/output/documents/');
    let fileUrl: string | undefined;
    let filename: string | undefined;

    if (isImage) {
      const m = text.match(/\/output\/images\/[^\s"']+\.(?:png|jpg|jpeg|webp)/i);
      if (m) { fileUrl = m[0]; filename = fileUrl.split('/').pop(); }
    } else if (isDocument) {
      const m = text.match(/\/output\/documents\/[^\s"']+\.docx/i);
      if (m) { fileUrl = m[0]; filename = fileUrl.split('/').pop(); }
    }

    setChatMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        sender,
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        isImage,
        isDocument,
        fileUrl,
        filename,
      },
    ]);
  }, []);

  // ─────────────────────────────────────────────
  // TTS Engine (bilingual: Urdu + English)
  // ─────────────────────────────────────────────
  const containsUrdu = (text: string) => /[\u0600-\u06FF]/.test(text);

  const setupAudioAnalyzer = useCallback((audio: HTMLAudioElement) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as WindowWithAudioContext).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      const src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!ttsAudioRef.current || ttsAudioRef.current.paused) { setAmplitude(0); return; }
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        setAmplitude(avg / 128);
        requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Fallback: math waveform
      const fake = () => {
        if (!ttsAudioRef.current || ttsAudioRef.current.paused) { setAmplitude(0); return; }
        setAmplitude(0.3 + 0.5 * Math.abs(Math.sin(Date.now() * 0.01)));
        setTimeout(fake, 50);
      };
      fake();
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.pause(); } catch { /**/ }
      ttsAudioRef.current = null;
    }
    setAmplitude(0);
  }, []);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /**/ }
      recognitionRef.current = null;
    }
    recognitionRunningRef.current = false;
  }, []);

  const duckMic = useCallback((duck: boolean) => {
    isMicDuckedRef.current = duck;
    if (duck) {
      stopRecognition();
    } else {
      setTimeout(() => startRecognitionRef.current(), 100);
    }
  }, [stopRecognition]);

  // Forward declarations so startRecognition can call itself
  const startRecognitionRef = useRef<() => void>(() => {});

  const fallbackNativeTTS = useCallback((text: string, lang: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const clean = text.replace(/```[\s\S]*?```/g, ' code snippet ').replace(/[*_`#>]/g, '');
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = lang;
    utt.rate = voiceSpeedRef.current;
    utt.pitch = voicePitchRef.current;
    const voices = synth.getVoices();
    if (lang.startsWith('ur')) {
      const v = voices.find(v => v.lang.startsWith('ur') || v.name.includes('Asma') || v.name.includes('Uzma'));
      if (v) utt.voice = v;
    } else {
      const v = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural')));
      if (v) utt.voice = v;
    }
    utt.onstart = () => { setVoiceState('speaking'); duckMic(true); };
    utt.onend = () => { setVoiceState('idle'); duckMic(false); setAmplitude(0); startRecognitionRef.current(); };
    utt.onerror = () => { setVoiceState('idle'); duckMic(false); setAmplitude(0); };
    synth.speak(utt);

    const fake = () => {
      if (!synth.speaking) { setAmplitude(0); return; }
      setAmplitude(0.2 + 0.4 * Math.abs(Math.sin(Date.now() * 0.008)));
      setTimeout(fake, 60);
    };
    fake();
  }, [duckMic]);

  const playGoogleUrduTTS = useCallback((text: string) => {
    cancelSpeech();
    const clean = text.replace(/```[\s\S]*?```/g, ' code snippet ').replace(/[*_`#>]/g, '');
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ur&client=tw-ob&q=${encodeURIComponent(clean.substring(0, 240))}`;
    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    setVoiceState('speaking');
    duckMic(true);

    audio.onended = () => {
      ttsAudioRef.current = null;
      setVoiceState('idle');
      duckMic(false);
      setAmplitude(0);
      startRecognitionRef.current();
    };
    audio.onerror = () => { fallbackNativeTTS(text, 'ur-PK'); };
    setupAudioAnalyzer(audio);
    audio.play().catch(() => fallbackNativeTTS(text, 'ur-PK'));
  }, [cancelSpeech, duckMic, fallbackNativeTTS, setupAudioAnalyzer]);

  const speakResponse = useCallback((text: string) => {
    if (isMutedRef.current || !text.trim()) return;
    if (containsUrdu(text) || currentLangRef.current.startsWith('ur')) {
      playGoogleUrduTTS(text);
    } else {
      fallbackNativeTTS(text, currentLangRef.current);
    }
  }, [playGoogleUrduTTS, fallbackNativeTTS]);

  // ─────────────────────────────────────────────
  // Speech Recognition (VAD-based)
  // ─────────────────────────────────────────────
  const commitVoiceQuery = useCallback((text: string) => {
    stopRecognition();
    setTranscript('');
    addMessage('OWNER', text);
    setVoiceState('thinking');

    if (socketRef.current) {
      socketRef.current.emit('user_message', {
        type: 'user_message',
        content: text,
        is_voice: true,
      });
    }
    pushActivity(`Voice: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`, 'MIC');
  }, [stopRecognition, addMessage, pushActivity]);

  const startRecognition = useCallback(() => {
    if (isMutedRef.current || recognitionRunningRef.current || isMicDuckedRef.current) return;
    const SpeechClass = (window as unknown as WindowWithSpeech).SpeechRecognition || (window as unknown as WindowWithSpeech).webkitSpeechRecognition;
    if (!SpeechClass) return;

    // Reset restart flag on fresh launch
    shouldRestartRef.current = true;

    const rec = new SpeechClass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = currentLangRef.current;

    rec.onstart = () => {
      recognitionRunningRef.current = true;
      setVoiceState('listening');
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      cancelSpeech();
      let final = '';
      let interim = '';
      const resultsLen = event.results.length;
      for (let i = event.resultIndex; i < resultsLen; ++i) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      const live = final || interim;
      setTranscript(live);

      if (vadTimerRef.current) clearTimeout(vadTimerRef.current);
      if (live.trim()) {
        vadTimerRef.current = setTimeout(() => commitVoiceQuery(live), 1200);
      }
    };

    rec.onend = () => {
      recognitionRunningRef.current = false;
      if (shouldRestartRef.current && !isMutedRef.current && !isMicDuckedRef.current) {
        setTimeout(() => startRecognitionRef.current(), 300);
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      recognitionRunningRef.current = false;
      console.log('Speech recognition debug log:', e.error);
      
      if (e.error === 'not-allowed') {
        shouldRestartRef.current = false;
        pushActivity('Microphone access denied. Please verify recording permissions in Windows settings.', 'ERROR');
      } else if (e.error === 'network') {
        shouldRestartRef.current = false;
        pushActivity('Speech Recognition network error. Google Speech servers are unreachable from Electron. Voice control disabled.', 'ERROR');
      } else if (e.error === 'no-speech') {
        // Safe timeout, ignore
      } else {
        pushActivity(`Mic Error: ${e.error || 'Unknown error'}`, 'WARN');
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch { /**/ }
  }, [cancelSpeech, commitVoiceQuery, pushActivity]);

  // Store latest ref so onend callbacks can call it
  useEffect(() => { startRecognitionRef.current = startRecognition; }, [startRecognition]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (next) {
      cancelSpeech();
      stopRecognition();
      setVoiceState('idle');
      pushActivity('Voice control offline — mic muted.', 'SYS');
    } else {
      isMicDuckedRef.current = false;
      shouldRestartRef.current = true; // Reset error flag on manual unmute
      pushActivity('Voice control online — listening.', 'SYS');
      setTimeout(() => startRecognitionRef.current(), 200);
    }
  }, [isMuted, cancelSpeech, stopRecognition, pushActivity]);

  // ─────────────────────────────────────────────
  // Text Submit
  // ─────────────────────────────────────────────
  const handleSendText = useCallback(() => {
    if (!textInput.trim() || !socketRef.current) return;
    const text = textInput.trim();
    setTextInput('');
    cancelSpeech();
    addMessage('OWNER', text);
    setVoiceState('thinking');
    socketRef.current.emit('user_message', { type: 'user_message', content: text, is_voice: false });
    pushActivity(`Command: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`, 'OK');
  }, [textInput, cancelSpeech, addMessage, pushActivity]);

  const handleQuickAction = useCallback((command: string) => {
    if (!socketRef.current) return;
    cancelSpeech();
    addMessage('OWNER', command);
    setVoiceState('thinking');
    socketRef.current.emit('user_message', { type: 'user_message', content: command, is_voice: false });
    pushActivity(`Quick: "${command}"`, 'SYS');
  }, [cancelSpeech, addMessage, pushActivity]);

  // ─────────────────────────────────────────────
  // Confirmation Gate
  // ─────────────────────────────────────────────
  const handleConfirmDecision = useCallback((id: string, approved: boolean) => {
    if (!socketRef.current) return;
    socketRef.current.emit('confirm_response', { type: 'confirm_response', confirm_id: id, approved });
    setConfirmGate(null);
    setVoiceState('idle');
    pushActivity(approved ? 'Privileged action approved.' : 'Privileged action denied.', approved ? 'OK' : 'WARN');
  }, [pushActivity]);

  // ─────────────────────────────────────────────
  // File Open (gateway /open command)
  // ─────────────────────────────────────────────
  const triggerOpen = useCallback((fileUrl: string) => {
    let p = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
    p = p.replace(/\//g, '\\');
    socketRef.current?.emit('user_message', { type: 'user_message', content: `/open ${p}`, is_voice: false });
  }, []);

  // ─────────────────────────────────────────────
  // WebSocket Pipeline
  // ─────────────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:3000');
    socketRef.current = socket;

    socket.on('connect', () => pushActivity('Gateway: Secure pipeline open.', 'OK'));
    socket.on('disconnect', () => {
      pushActivity('Gateway: Connection lost.', 'WARN');
      setVoiceState('error');
    });

    socket.on('agent_state', (data: { state: string }) => {
      const map: Record<string, VoiceState> = {
        IDLE: 'idle', THINKING: 'thinking', ACTING: 'thinking', SPEAKING: 'speaking',
      };
      const next = map[data.state] ?? 'idle';
      setVoiceState(next);
      if (next === 'idle') duckMic(false);
      else duckMic(true);
    });

    socket.on('step', (data: { step_num: number; kind: string; content: string }) => {
      pushActivity(`[${data.kind.toUpperCase()}] ${data.content.slice(0, 80)}`, 'SYS');
    });

    socket.on('agent_response', (data: { content: string; speak_text: string }) => {
      addMessage('JARVIS', data.content);
      setLastResponse(data.speak_text || data.content);
      pushActivity(`JARVIS: ${data.content.slice(0, 60)}${data.content.length > 60 ? '…' : ''}`, 'OK');
      speakResponse(data.speak_text || data.content);
    });

    socket.on('log', (data: { level: ActivityEntry['level']; message: string }) => {
      pushActivity(data.message, data.level);
    });

    socket.on('memory', () => {
      pushActivity('Memory updated.', 'SYS');
    });

    socket.on('require_confirmation', (data: ConfirmGate) => {
      setConfirmGate(data);
      setVoiceState('confirming');
      speakResponse(`Authorization required. I need permission to execute ${data.tool}.`);
      pushActivity(`AUTH REQUIRED: ${data.tool}`, 'WARN');
    });

    socket.on('vitals', (payload: VitalsPayload) => {
      if (payload?.data) {
        setVitals({
          cpu: payload.data.cpu ?? 0,
          ram: payload.data.ram ?? 0,
          battery: payload.data.battery ?? 0,
          netUp: payload.data.network?.sent_mb ?? 0,
          netDown: payload.data.network?.recv_kb ?? 0,
        });
      }
    });

    return () => { socket.disconnect(); };
  }, [pushActivity, addMessage, speakResponse, duckMic]);

  // Auto-start voice recognition on mount & verify microphone permission
  useEffect(() => {
    // Add welcome message only on client mount
    addMessage('JARVIS', 'Systems online. All diagnostic checks completed. J.A.R.V.I.S. is ready to assist you. Ask me anything or say "Jarvis" to voice control.');

    // Browser diagnostics
    if (typeof window !== 'undefined') {
      const isBrave = !!(navigator as any).brave;
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
      const isChrome = navigator.userAgent.toLowerCase().includes('chrome') && !navigator.userAgent.toLowerCase().includes('edg') && !isBrave;

      if (isBrave) {
        pushActivity('Brave detected: Google speech services are blocked by default. Enable "Use Google services for speech recognition" in brave://settings/system.', 'WARN');
      } else if (isFirefox) {
        pushActivity('Firefox detected: Web Speech API is experimental. Use Google Chrome or Microsoft Edge for best results.', 'WARN');
      } else if (isChrome) {
        pushActivity('Chrome detected: Speech recognition online (requires internet to connect to Google Cloud Speech servers).', 'SYS');
      }
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          pushActivity('Microphone hardware verified & active.', 'OK');
          stream.getTracks().forEach(track => track.stop());
        })
        .catch((err) => {
          console.log('Microphone hardware check log:', err);
          pushActivity(`Microphone Initialization Error: ${err.name || 'AccessDenied'}. Please verify recording devices are enabled in Windows settings.`, 'ERROR');
        });
    }
    const id = setTimeout(() => startRecognitionRef.current(), 800);
    return () => clearTimeout(id);
  }, [pushActivity, addMessage]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setChatMessages([]);
        pushActivity('Chat cleared.', 'SYS');
      }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setIsSettingsOpen(p => !p); }
      if (e.key === 'Escape') { setIsSettingsOpen(false); setConfirmGate(null); }
      const active = document.activeElement;
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
      if (!inInput && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pushActivity]);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: 'var(--bg-0)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* ── STATUS BAR ── */}
      <StatusBar voiceState={voiceState} />

      {/* ── THREE-COLUMN HUD ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr 260px',
          flex: '0 0 auto',
          borderBottom: '1px solid var(--hairline)',
          background: 'var(--bg-1)',
          minHeight: 380,
          maxHeight: 420,
        }}
      >
        <SystemPanel
          cpu={vitals.cpu}
          ram={vitals.ram}
          battery={vitals.battery}
          netUp={vitals.netUp}
          netDown={vitals.netDown}
        />

        <VoicePanel
          voiceState={voiceState}
          amplitude={amplitude}
          transcript={transcript}
          response={lastResponse}
          pendingConfirmation={confirmGate}
          onConfirm={handleConfirmDecision}
        />

        <ActivityPanel entries={activityLog} />
      </div>

      {/* ── QUICK ACTIONS BAR ── */}
      <QuickActionsBar onAction={handleQuickAction} />

      {/* ── CHAT THREAD ── */}
      <div className="chat-wrapper" style={{ flex: 1, minHeight: 0 }}>
        {chatMessages.length === 0 && (
          <div
            style={{
              color: 'var(--text-low)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              textAlign: 'center',
              margin: 'auto',
              opacity: 0.6,
              paddingTop: 24,
            }}
          >
            Awaiting instructions…
          </div>
        )}

        {chatMessages.map(msg => (
          <div
            key={msg.id}
            className={`chat-msg ${msg.sender === 'OWNER' ? 'owner' : 'jarvis'}`}
          >
            <span className="sender-label">
              {msg.timestamp} &nbsp; {msg.sender === 'OWNER' ? 'YOU' : 'JARVIS'}
            </span>

            {/* Standard text message */}
            {!msg.isImage && !msg.isDocument && (
              <div className="chat-bubble" style={{ userSelect: 'text' }}>
                {msg.text}
              </div>
            )}

            {/* Generated image card */}
            {msg.isImage && msg.fileUrl && (
              <div className="chat-bubble" style={{ userSelect: 'text' }}>
                <div style={{ marginBottom: 8, color: 'var(--text-mid)', fontSize: 12 }}>
                  {msg.text.replace(msg.fileUrl, '').trim()}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`http://localhost:8000${msg.fileUrl}`}
                  alt={msg.filename ?? 'Generated image'}
                  className="chat-image"
                  style={{ maxWidth: '100%' }}
                />
              </div>
            )}

            {/* Document card */}
            {msg.isDocument && msg.fileUrl && (
              <div className="chat-bubble" style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'text' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text-mid)', fontSize: 12, marginBottom: 4 }}>
                    {msg.text.replace(msg.fileUrl, '').trim()}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--amber-400)' }}>
                    📄 {msg.filename}
                  </div>
                </div>
                <button
                  onClick={() => triggerOpen(msg.fileUrl!)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--hairline)',
                    borderRadius: 3,
                    padding: '5px 8px',
                    color: 'var(--text-mid)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                  }}
                  title="Open file"
                >
                  <ExternalLink size={12} /> Open
                </button>
              </div>
            )}
          </div>
        ))}

        <div ref={chatBottomRef} />
      </div>

      {/* ── INPUT BAR ── */}
      <div className="input-bar">
        <input
          ref={inputRef}
          type="text"
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendText()}
          placeholder="Instruct J.A.R.V.I.S…"
          autoFocus
        />

        <button
          onClick={toggleMute}
          className={isMuted ? 'muted' : 'active'}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} className={voiceState === 'listening' ? '' : ''} />}
        </button>

        <button
          onClick={handleSendText}
          title="Send"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>

        <button
          onClick={() => setChatMessages([])}
          title="Clear chat (Ctrl+L)"
          aria-label="Clear chat history"
        >
          <Trash2 size={16} />
        </button>

        <button
          onClick={() => setIsSettingsOpen(p => !p)}
          className={isSettingsOpen ? 'active' : ''}
          title="Settings (Ctrl+,)"
          aria-label="Toggle settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ── SETTINGS MODAL ── */}
      {isSettingsOpen && (
        <div
          className="settings-overlay"
          onClick={e => { if (e.target === e.currentTarget) setIsSettingsOpen(false); }}
          aria-modal="true"
          role="dialog"
        >
          <div className="settings-modal">
            <h2>Engine Settings</h2>

            <div className="settings-row">
              <label>Language</label>
              <select value={currentLang} onChange={e => setCurrentLang(e.target.value)}>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="ur-PK">Urdu (Pakistan)</option>
                <option value="ur">Urdu</option>
              </select>
            </div>

            <div className="settings-row">
              <label>Voice speed — {voiceSpeed.toFixed(2)}×</label>
              <input
                type="range" min="0.5" max="2.0" step="0.05"
                value={voiceSpeed}
                onChange={e => setVoiceSpeed(parseFloat(e.target.value))}
              />
            </div>

            <div className="settings-row">
              <label>Voice pitch — {voicePitch.toFixed(2)}</label>
              <input
                type="range" min="0.5" max="2.0" step="0.05"
                value={voicePitch}
                onChange={e => setVoicePitch(parseFloat(e.target.value))}
              />
            </div>

            <div className="settings-row">
              <label>Model</label>
              <select value={activeModel} onChange={e => setActiveModel(e.target.value)}>
                <option value="nvidia/nemotron-3-ultra-550b-a55b">Nemotron Ultra 550B</option>
                <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="anthropic/claude-sonnet-4">Claude Sonnet 4</option>
                <option value="openai/gpt-4o">GPT-4o</option>
              </select>
            </div>

            <div className="settings-row">
              <label>Temperature — {temperature.toFixed(2)}</label>
              <input
                type="range" min="0" max="1" step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                className="chip"
                onClick={() => setIsSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
