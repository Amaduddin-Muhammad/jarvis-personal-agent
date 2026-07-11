'use client';

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Cpu, Activity, HardDrive, Wifi, Bell, Shield, 
  Send, Mic, MicOff, Settings, BookOpen, Clock, 
  Terminal, Trash2, Maximize2, Minimize2, ExternalLink, Play
} from 'lucide-react';
import ThreeVisualizer from './components/ThreeVisualizer';
import { motion, AnimatePresence } from 'framer-motion';

// Types
interface Message {
  id: string;
  sender: 'OWNER' | 'JARVIS';
  text: string;
  timestamp: string;
  isImage?: boolean;
  isDocument?: boolean;
  fileUrl?: string;
  filename?: string;
}

interface ThoughtStep {
  id: string;
  stepNum: number;
  kind: 'think' | 'act' | 'observe';
  content: string;
}

interface SystemLog {
  id: string;
  timestamp: string;
  level: 'OK' | 'WARN' | 'ERROR' | 'SYS' | 'MIC';
  message: string;
}

interface Vitals {
  cpu: number;
  ram: number;
  battery: number;
  netUp: number;
  netDown: number;
}

export default function JarvisDashboard() {
  // Agent States
  const [agentState, setAgentState] = useState<'IDLE' | 'THINKING' | 'ACTING' | 'SPEAKING'>('IDLE');
  const [isMuted, setIsMuted] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [thoughtSteps, setThoughtSteps] = useState<ThoughtStep[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<string[]>([]);
  const [volumeLevel, setVolumeLevel] = useState(0.0);
  const [textInput, setTextInput] = useState('');
  
  // Vitals
  const [vitals, setVitals] = useState<Vitals>({ cpu: 12, ram: 45, battery: 100, netUp: 0.1, netDown: 1.2 });
  
  // Settings Panel
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeModel, setActiveModel] = useState('nvidia/nemotron-3-ultra-550b-a55b');
  const [temperature, setTemperature] = useState(0.7);
  const [voiceSpeed, setVoiceSpeed] = useState(1.05);
  const [voicePitch, setVoicePitch] = useState(0.95);
  const [currentLang, setCurrentLang] = useState('en-US');

  // Privileged Action Gate
  const [confirmGate, setConfirmGate] = useState<{ id: string; tool: string; scope: string; rationale: string } | null>(null);

  // References
  const socketRef = useRef<Socket | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const logsBottomRef = useRef<HTMLDivElement>(null);
  
  // Speech Core References
  const recognitionRef = useRef<any>(null);
  const recognitionRunningRef = useRef(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const isMicDuckedRef = useRef(false);
  const vadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  // ==========================================
  // WEBSOCKET PIPELINE (NestJS Gateway)
  // ==========================================
  useEffect(() => {
    // Connect to NestJS WebSocket Gateway
    const socket = io('http://localhost:3000');
    socketRef.current = socket;

    socket.on('connect', () => {
      addLog('SYS', 'NestJS Gateway: Secure WebSocket pipe active.');
    });

    socket.on('disconnect', () => {
      addLog('WARN', 'NestJS Gateway: Secure WebSocket pipe disconnected.');
    });

    // Listen for agent state changes
    socket.on('agent_state', (data: { state: 'IDLE' | 'THINKING' | 'ACTING' | 'SPEAKING' }) => {
      setAgentState(data.state);
      // Auto-duck mic on thinking/acting/speaking
      if (data.state === 'IDLE') {
        duckMic(false);
      } else {
        duckMic(true);
      }
    });

    // Listen for agent thought steps
    socket.on('step', (data: { step_num: number; kind: 'think' | 'act' | 'observe'; content: string }) => {
      setThoughtSteps(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          stepNum: data.step_num,
          kind: data.kind,
          content: data.content,
        }
      ]);
    });

    // Listen for final agent responses
    socket.on('agent_response', (data: { content: string; speak_text: string }) => {
      addMessage('JARVIS', data.content);
      speakResponse(data.speak_text);
    });

    // Listen for logs
    socket.on('log', (data: { level: 'OK' | 'WARN' | 'ERROR' | 'SYS' | 'MIC'; message: string }) => {
      addLog(data.level, data.message);
    });

    // Listen for memory updates
    socket.on('memory', (data: { facts: string[] }) => {
      setMemoryFacts(data.facts);
    });

    // Listen for privileged authorization requests
    socket.on('require_confirmation', (data: { id: string; tool: string; scope: string; rationale: string }) => {
      setConfirmGate(data);
      speakResponse(`Action authorization required. I need permission to execute ${data.tool}.`);
    });

    // Listen for vitals metrics from Python core stats
    socket.on('vitals', (data: Vitals) => {
      setVitals(data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Auto-scroll lists
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [systemLogs]);

  // ==========================================
  // HELPERS
  // ==========================================
  const addLog = (level: 'OK' | 'WARN' | 'ERROR' | 'SYS' | 'MIC', message: string) => {
    setSystemLogs(prev => [
      ...prev,
      {
        id: Math.random().toString(),
        timestamp: new Date().toLocaleTimeString(),
        level,
        message,
      }
    ]);
  };

  const addMessage = (sender: 'OWNER' | 'JARVIS', text: string) => {
    // Check if message content contains generated asset URLs
    const isImage = text.includes('/output/images/');
    const isDocument = text.includes('/output/documents/');
    let fileUrl = undefined;
    let filename = undefined;

    if (isImage) {
      const match = text.match(/\/output\/images\/[^\s"']+\.(?:png|jpg|jpeg|webp)/i);
      if (match) {
        fileUrl = match[0];
        filename = fileUrl.split('/').pop();
      }
    } else if (isDocument) {
      const match = text.match(/\/output\/documents\/[^\s"']+\.docx/i);
      if (match) {
        fileUrl = match[0];
        filename = fileUrl.split('/').pop();
      }
    }

    setChatMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(),
        sender,
        text,
        timestamp: new Date().toLocaleTimeString(),
        isImage,
        isDocument,
        fileUrl,
        filename,
      }
    ]);
  };

  // Submit Text Query
  const handleSendText = () => {
    if (!textInput.trim() || !socketRef.current) return;
    const text = textInput;
    setTextInput('');
    
    // Stop any active speech on new submit (barge-in)
    cancelSpeech();

    addMessage('OWNER', text);
    setThoughtSteps([]); // Clear old thoughts
    setAgentState('THINKING');

    socketRef.current.emit('user_message', {
      type: 'user_message',
      content: text,
      is_voice: false,
    });
  };

  // ==========================================
  // BILINGUAL SPEECH & TTS FALLBACK ENGINE
  // ==========================================
  
  // Detect Urdu text
  const containsUrdu = (text: string) => /[\u0600-\u06FF]/.test(text);

  // Play natural Google Translate Urdu TTS stream
  const playGoogleUrduTTS = (text: string) => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }

    // Clean text (remove markdown symbols)
    const cleanText = text.replace(/```[\s\S]*?```/g, ', code snippet,').replace(/[*_`#>]/g, '');
    const encoded = encodeURIComponent(cleanText.substring(0, 240));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ur&client=tw-ob&q=${encoded}`;

    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    
    setAgentState('SPEAKING');
    duckMic(true);
    addLog('SYS', 'JARVIS speaking (Natural Online Urdu Core) — mic ducked.');

    audio.onended = () => {
      ttsAudioRef.current = null;
      setAgentState('IDLE');
      duckMic(false);
      addLog('MIC', 'Speech complete — mic resumed.');
    };

    audio.onerror = () => {
      ttsAudioRef.current = null;
      fallbackNativeTTS(text, 'ur-PK');
    };

    // Animate visualizer frequency based on HTML5 Audio Context
    setupAudioContextAnalyzer(audio);

    audio.play().catch(() => {
      fallbackNativeTTS(text, 'ur-PK');
    });
  };

  // Setup visualizer analyzer for HTML5 Audio playback
  const setupAudioContextAnalyzer = (audio: HTMLAudioElement) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      // Animation loop to calculate volumeLevel
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!ttsAudioRef.current || ttsAudioRef.current.paused) {
          setVolumeLevel(0);
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        dataArray.forEach(val => sum += val);
        const avg = sum / dataArray.length;
        setVolumeLevel(avg / 128);
        requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch (e) {
      // Audio element already routed or security block - fallback to math waveform
      const fakeVolumeAnimation = () => {
        if (!ttsAudioRef.current || ttsAudioRef.current.paused) {
          setVolumeLevel(0);
          return;
        }
        setVolumeLevel(0.3 + 0.5 * Math.abs(Math.sin(Date.now() * 0.01)));
        setTimeout(fakeVolumeAnimation, 50);
      };
      fakeVolumeAnimation();
    }
  };

  // Fallback to local browser SpeechSynthesis
  const fallbackNativeTTS = (text: string, lang: string) => {
    addLog('WARN', 'Google Online TTS failed. Using native browser speech synth...');
    const speechSynth = window.speechSynthesis;
    speechSynth.cancel();

    const cleanText = text.replace(/```[\s\S]*?```/g, ', code snippet,').replace(/[*_`#>]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = lang;
    utterance.rate = voiceSpeed;
    utterance.pitch = voicePitch;

    // Prioritize named voices
    const voices = speechSynth.getVoices();
    if (lang.startsWith('ur')) {
      const urduVoice = voices.find(v => v.lang.startsWith('ur') || v.name.includes('Asma') || v.name.includes('Uzma'));
      if (urduVoice) utterance.voice = urduVoice;
    } else {
      const engVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural')));
      if (engVoice) utterance.voice = engVoice;
    }

    utterance.onstart = () => {
      setAgentState('SPEAKING');
      duckMic(true);
    };

    utterance.onend = () => {
      setAgentState('IDLE');
      duckMic(false);
    };

    utterance.onerror = () => {
      setAgentState('IDLE');
      duckMic(false);
    };

    speechSynth.speak(utterance);

    // Simulate waveform
    const fakeVolumeAnimation = () => {
      if (!speechSynth.speaking) {
        setVolumeLevel(0);
        return;
      }
      setVolumeLevel(0.2 + 0.4 * Math.abs(Math.sin(Date.now() * 0.008)));
      setTimeout(fakeVolumeAnimation, 60);
    };
    fakeVolumeAnimation();
  };

  // Main speech triggering routing
  const speakResponse = (text: string) => {
    if (isMuted || !text.trim()) return;

    if (containsUrdu(text) || currentLang.startsWith('ur')) {
      playGoogleUrduTTS(text);
    } else {
      fallbackNativeTTS(text, currentLang);
    }
  };

  // Stop/cancel active TTS playback
  const cancelSpeech = () => {
    window.speechSynthesis.cancel();
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.pause(); } catch(e) {}
      ttsAudioRef.current = null;
    }
    setVolumeLevel(0);
  };

  // Controls microphone ducking to prevent audio loop feedback
  const duckMic = (shouldDuck: boolean) => {
    isMicDuckedRef.current = shouldDuck;
    if (shouldDuck) {
      stopVoiceRecognition();
    } else {
      startVoiceRecognition();
    }
  };

  // Start continuous Web Speech recognition
  const startVoiceRecognition = () => {
    if (isMuted || recognitionRunningRef.current || isMicDuckedRef.current) return;

    const SpeechClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechClass) {
      addLog('WARN', 'Web Speech API is not supported in this browser.');
      return;
    }

    const rec = new SpeechClass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = currentLang;

    rec.onstart = () => {
      recognitionRunningRef.current = true;
      addLog('MIC', `Listening continuously in [${currentLang.toUpperCase()}]...`);
    };

    rec.onresult = (event: any) => {
      // Barge-in: interrupt JARVIS speaking if user starts talking
      cancelSpeech();

      let finalResult = '';
      let interimResult = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalResult += transcript;
        } else {
          interimResult += transcript;
        }
      }

      // Live transcript feedback in GUI
      const liveFeedback = finalResult || interimResult;
      const feedbackEl = document.getElementById('interim-feedback-box');
      if (feedbackEl && liveFeedback.trim()) {
        feedbackEl.innerText = liveFeedback;
        feedbackEl.classList.remove('hidden');
      }

      // Voice Activity Detection (VAD) silence trigger
      if (vadTimerRef.current) clearTimeout(vadTimerRef.current);
      if (liveFeedback.trim()) {
        vadTimerRef.current = setTimeout(() => {
          commitVoiceQuery(liveFeedback);
        }, 1200); // 1.2s silence timer
      }
    };

    rec.onend = () => {
      recognitionRunningRef.current = false;
      // Auto-restart if we didn't mute or duck
      if (!isMuted && !isMicDuckedRef.current) {
        setTimeout(startVoiceRecognition, 300);
      }
    };

    rec.onerror = (e: any) => {
      console.error('Speech error:', e.error);
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const stopVoiceRecognition = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch(e) {}
      recognitionRef.current = null;
    }
    recognitionRunningRef.current = false;
    const feedbackEl = document.getElementById('interim-feedback-box');
    if (feedbackEl) feedbackEl.classList.add('hidden');
  };

  const commitVoiceQuery = (text: string) => {
    stopVoiceRecognition();
    const feedbackEl = document.getElementById('interim-feedback-box');
    if (feedbackEl) feedbackEl.classList.add('hidden');

    addMessage('OWNER', text);
    setThoughtSteps([]);
    setAgentState('THINKING');

    if (socketRef.current) {
      socketRef.current.emit('user_message', {
        type: 'user_message',
        content: text,
        is_voice: true,
      });
    }
  };

  // Toggle Mute
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      cancelSpeech();
      stopVoiceRecognition();
      addLog('SYS', 'Voice control offline — loops disarmed.');
    } else {
      isMicDuckedRef.current = false;
      addLog('SYS', 'Voice control online — listening.');
      // Wait a bit to ensure old instances are disposed
      setTimeout(startVoiceRecognition, 200);
    }
  };

  // ==========================================
  // PRIVILEGED TOOL GATES
  // ==========================================
  const handleAuthDecision = (approved: boolean) => {
    if (!confirmGate || !socketRef.current) return;
    socketRef.current.emit('confirm_response', {
      type: 'confirm_response',
      confirm_id: confirmGate.id,
      approved,
    });
    setConfirmGate(null);
    addLog('SYS', approved ? 'Privileged tool call approved.' : 'Privileged tool call denied.');
  };

  // Direct open file command from HUD download cards
  const triggerDirectOpen = (fileUrl: string) => {
    // Relative url /output/documents/file.docx -> filepath output\documents\file.docx
    let relativePath = fileUrl;
    if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);
    relativePath = relativePath.replace(/\//g, '\\');

    if (socketRef.current) {
      socketRef.current.emit('user_message', {
        type: 'user_message',
        content: `/open ${relativePath}`,
        is_voice: false,
      });
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#05070f] relative overflow-hidden select-none p-4 gap-4">
      {/* CRT SCANLINE AND radial ambient GLOW */}
      <div className="crt-overlay" />
      <div className="scanlines" />

      {/* ── LEFT PANEL: CHAT & TERMINAL ── */}
      <div className="flex-[3] flex flex-col glass-panel p-4 gap-3 relative z-10">
        <div className="flex justify-between items-center border-b border-[rgba(58,214,255,0.15)] pb-2">
          <div className="flex items-center gap-2">
            <Terminal className="text-[#3ad6ff] w-5 h-5 animate-pulse" />
            <h2 className="font-mono text-sm tracking-widest text-[#3ad6ff]">JARVIS HUD CONSOLE</h2>
          </div>
          <button 
            onClick={() => setChatMessages([])}
            className="text-[#8b9fb4] hover:text-[#ff4d4d] transition-colors"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Chat message stream */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 font-mono text-[0.82rem]">
          {chatMessages.length === 0 && (
            <div className="text-[#8b9fb4] text-center my-auto opacity-40 italic">
              Awaiting owner input...
            </div>
          )}
          
          {chatMessages.map(msg => (
            <div 
              key={msg.id} 
              className={`flex flex-col gap-1 p-2 rounded border max-w-[85%] ${
                msg.sender === 'OWNER' 
                  ? 'border-[rgba(58,214,255,0.15)] bg-[rgba(58,214,255,0.03)] self-end' 
                  : 'border-[rgba(51,255,153,0.15)] bg-[rgba(51,255,153,0.03)] self-start'
              }`}
            >
              <span className={`text-[0.65rem] tracking-widest ${msg.sender === 'OWNER' ? 'text-[#3ad6ff]' : 'text-[#33ff99]'}`}>
                [{msg.timestamp}] {msg.sender}
              </span>
              
              {/* If it's a standard markdown text response */}
              {!msg.isImage && !msg.isDocument && (
                <div className="selectable-text whitespace-pre-wrap leading-relaxed text-[#ffffff]">
                  {msg.text}
                </div>
              )}

              {/* Generated Image card */}
              {msg.isImage && msg.fileUrl && (
                <div className="flex flex-col rounded overflow-hidden border border-[rgba(51,255,153,0.3)] bg-black max-w-[400px]">
                  <img 
                    src={msg.fileUrl} 
                    alt={msg.filename} 
                    className="max-h-[300px] object-contain cursor-zoom-in hover:scale-[1.01] transition-transform"
                    onClick={() => window.open(msg.fileUrl, '_blank')}
                  />
                  <div className="flex justify-between items-center p-2 bg-[rgba(10,16,12,0.9)] text-[0.7rem] border-t border-[rgba(51,255,153,0.15)]">
                    <span className="text-[#8b9fb4] truncate max-w-[200px]">📁 {msg.filename}</span>
                    <a href={msg.fileUrl} target="_blank" className="text-[#33ff99] border border-[rgba(51,255,153,0.3)] px-2 py-0.5 rounded hover:bg-[rgba(51,255,153,0.1)]">OPEN ↗</a>
                  </div>
                </div>
              )}

              {/* Generated Document card */}
              {msg.isDocument && msg.fileUrl && (
                <div className="flex items-center gap-3 p-3 rounded border border-[rgba(58,214,255,0.3)] bg-[rgba(14,22,40,0.9)] max-w-[380px]">
                  <span className="text-3xl">📄</span>
                  <div className="flex-1 overflow-hidden">
                    <div className="text-[#3ad6ff] font-semibold truncate text-[0.76rem]">{msg.filename}</div>
                    <button 
                      onClick={() => triggerDirectOpen(msg.fileUrl!)} 
                      className="mt-2 text-[0.68rem] text-[#3ad6ff] border border-[rgba(58,214,255,0.3)] px-2 py-1 rounded hover:bg-[rgba(58,214,255,0.15)] flex items-center gap-1"
                    >
                      OPEN IN WORD <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>

        {/* Live Interim Transcript pulsing bar */}
        <div 
          id="interim-feedback-box" 
          className="hidden interim-pulse border border-[#3ad6ff] text-[#3ad6ff] font-mono text-xs p-2 rounded text-center tracking-wide"
        >
          ...
        </div>

        {/* Input box */}
        <div className="flex gap-2 items-center bg-[rgba(11,18,32,0.4)] border border-[rgba(58,214,255,0.15)] rounded-lg p-1.5">
          <input 
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
            placeholder="Instruct J.A.R.V.I.S..."
            className="flex-1 bg-transparent outline-none border-none font-mono text-sm px-2 text-[#ffffff] placeholder-[#3d4a45]"
          />
          <button 
            onClick={toggleMute}
            className={`p-2 rounded-full transition-all ${
              isMuted 
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                : 'bg-green-500/10 text-[#33ff99] hover:bg-green-500/20'
            }`}
            title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 animate-pulse" />}
          </button>
          <button 
            onClick={handleSendText}
            className="bg-[#3ad6ff]/10 text-[#3ad6ff] hover:bg-[#3ad6ff]/20 p-2 rounded-full transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── MIDDLE PANEL: Holographic 3D AI Core ── */}
      <div className="flex-[3.5] flex flex-col gap-4 relative z-10">
        <div className="flex-1 glass-panel flex flex-col items-center justify-center p-4 relative overflow-hidden">
          <div className="absolute top-4 left-4 flex flex-col font-mono text-xs text-[#8b9fb4] gap-1">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                agentState === 'IDLE' ? 'bg-green-400' :
                agentState === 'THINKING' ? 'bg-purple-500 animate-ping' :
                agentState === 'ACTING' ? 'bg-orange-500 animate-spin' : 'bg-green-500 animate-pulse'
              }`} />
              <span className="font-semibold text-white">CORE STATUS: {agentState}</span>
            </div>
            <span>VOLUME WAVE: {(volumeLevel * 100).toFixed(0)}%</span>
          </div>

          {/* Interactive 3D Three.js Visualizer Orb */}
          <ThreeVisualizer agentState={agentState} volumeLevel={volumeLevel} />
          
          <div className="absolute bottom-4 flex gap-4 text-xs font-mono tracking-widest text-[#3ad6ff]">
            <span>SYSTEM V.3.0</span>
            <span>INTELLIGENT OS</span>
          </div>
        </div>

        {/* Thought Chain step block */}
        <div className="h-[220px] glass-panel p-4 flex flex-col gap-2 overflow-hidden">
          <div className="flex justify-between items-center border-b border-[rgba(58,214,255,0.15)] pb-1.5">
            <div className="flex items-center gap-1.5">
              <Activity className="text-purple-400 w-4 h-4" />
              <h3 className="font-mono text-xs tracking-wider text-purple-400">THOUGHT CHAIN (INTERNAL REASONING)</h3>
            </div>
            <span className="text-[0.62rem] text-[#8b9fb4] font-mono">LANGGRAPH ROUTER ACTIVE</span>
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 font-mono text-[0.72rem] text-[#8b9fb4]">
            {thoughtSteps.length === 0 && (
              <div className="my-auto text-center opacity-30 italic">Reasoning steps appear during execution...</div>
            )}
            {thoughtSteps.map(step => (
              <div 
                key={step.id} 
                className={`p-2 rounded border border-[rgba(255,255,255,0.05)] ${
                  step.kind === 'think' ? 'bg-purple-500/5 text-purple-300' :
                  step.kind === 'act' ? 'bg-amber-500/5 text-amber-300' : 'bg-blue-500/5 text-blue-300'
                }`}
              >
                <span className="font-semibold uppercase text-[0.65rem] mr-2">
                  [{step.kind === 'think' ? '🧠 THINK' : step.kind === 'act' ? '⚙ ACT' : '👁 OBSERVE'} #{step.stepNum}]
                </span>
                <span className="selectable-text">{step.content}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL: SYSTEM VITALS, MEMORIES, & LOGS ── */}
      <div className="flex-[2.5] flex flex-col gap-4 relative z-10">
        
        {/* System Vitals Widget */}
        <div className="glass-panel p-4 flex flex-col gap-3">
          <h3 className="font-mono text-xs tracking-wider border-b border-[rgba(58,214,255,0.15)] pb-1.5 flex items-center gap-1.5">
            <Cpu className="text-[#3ad6ff] w-4 h-4" /> SYSTEM MONITOR
          </h3>
          <div className="grid grid-cols-2 gap-3 font-mono text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-[#8b9fb4] text-[0.68rem] uppercase">CPU USAGE</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#3ad6ff] h-full" style={{ width: `${vitals.cpu}%` }} />
                </div>
                <span>{vitals.cpu}%</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[#8b9fb4] text-[0.68rem] uppercase">MEMORY</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#33ff99] h-full" style={{ width: `${vitals.ram}%` }} />
                </div>
                <span>{vitals.ram}%</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[#8b9fb4] text-[0.68rem] uppercase">BATTERY</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-yellow-400 h-full" style={{ width: `${vitals.battery}%` }} />
                </div>
                <span>{vitals.battery}%</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[#8b9fb4] text-[0.68rem] uppercase">NET TRAFFIC</span>
              <div className="flex items-center justify-between text-[0.7rem] text-[#3ad6ff]">
                <span>↑ {vitals.netUp.toFixed(1)} MB/s</span>
                <span>↓ {vitals.netDown.toFixed(1)} KB/s</span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Memory Core Widget */}
        <div className="flex-1 glass-panel p-4 flex flex-col gap-2 overflow-hidden">
          <h3 className="font-mono text-xs tracking-wider border-b border-[rgba(58,214,255,0.15)] pb-1.5 flex items-center gap-1.5">
            <BookOpen className="text-[#33ff99] w-4 h-4" /> KNOWLEDGE & FACTS
          </h3>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 font-mono text-[0.72rem] text-[#8b9fb4]">
            {memoryFacts.length === 0 && (
              <div className="my-auto text-center opacity-30 italic">No semantic memory facts loaded yet.</div>
            )}
            {memoryFacts.map((fact, idx) => (
              <div key={idx} className="p-1.5 rounded border border-white/5 bg-white/2 select-text hover:border-green-500/20 transition-colors">
                • {fact}
              </div>
            ))}
          </div>
        </div>

        {/* System & Audit Logs */}
        <div className="h-[200px] glass-panel p-4 flex flex-col gap-2 overflow-hidden">
          <h3 className="font-mono text-xs tracking-wider border-b border-[rgba(58,214,255,0.15)] pb-1.5 flex items-center gap-1.5">
            <Shield className="text-[#ffb84d] w-4 h-4 animate-pulse" /> SECURITY AUDIT LOGS
          </h3>
          <div className="flex-1 overflow-y-auto flex flex-col gap-1 font-mono text-[0.68rem] text-[#8b9fb4]">
            {systemLogs.map(log => (
              <div key={log.id} className="selectable-text truncate leading-relaxed">
                <span className="text-[#566e85]">[{log.timestamp}]</span>{' '}
                <span className={
                  log.level === 'OK' ? 'text-green-400' :
                  log.level === 'WARN' ? 'text-amber-500' :
                  log.level === 'ERROR' ? 'text-red-500' : 'text-[#3ad6ff]'
                }>
                  {log.level}
                </span>{' '}
                - {log.message}
              </div>
            ))}
            <div ref={logsBottomRef} />
          </div>
        </div>
      </div>

      {/* ── FLOATING SETTINGS TOGGLE ── */}
      <button 
        onClick={() => setIsSettingsOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-[#0b1220] border border-[#3ad6ff]/30 text-[#3ad6ff] hover:bg-[#3ad6ff]/10 hover:border-[#3ad6ff] p-3 rounded-full shadow-lg transition-all"
        title="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* ── MODAL: SETTINGS PANEL ── */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-[480px] glass-panel p-5 flex flex-col gap-4 font-mono text-xs text-[#8b9fb4]"
          >
            <div className="flex justify-between items-center border-b border-white/10 pb-2">
              <h3 className="text-white text-sm font-semibold flex items-center gap-1.5"><Settings className="w-4 h-4" /> DEVELOPER ENGINE SETTINGS</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-[#ff4d4d] hover:underline">CLOSE</button>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-white">ACTIVE COGNITIVE MODEL:</span>
              <select 
                value={activeModel} 
                onChange={(e) => setActiveModel(e.target.value)}
                className="bg-black/50 border border-white/10 p-2 rounded text-white outline-none"
              >
                <option value="nvidia/nemotron-3-ultra-550b-a55b">nvidia/nemotron-3-ultra-550b-a55b (Default)</option>
                <option value="anthropic/claude-3-5-sonnet">anthropic/claude-3-5-sonnet</option>
                <option value="openai/gpt-4o">openai/gpt-4o</option>
                <option value="google/gemini-1.5-pro">google/gemini-1.5-pro</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-white">TEMPERATURE:</span>
                <span>{temperature.toFixed(1)}</span>
              </div>
              <input 
                type="range" 
                min="0.1" 
                max="1.0" 
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="accent-[#3ad6ff] cursor-pointer"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-white">TTS PLAYBACK SPEED:</span>
                <span>{voiceSpeed.toFixed(2)}x</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.05"
                value={voiceSpeed}
                onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                className="accent-[#33ff99] cursor-pointer"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-white">TTS PITCH:</span>
                <span>{voicePitch.toFixed(2)}</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.05"
                value={voicePitch}
                onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
                className="accent-[#33ff99] cursor-pointer"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-white">SPEECH LOCALE (STT/TTS):</span>
              <select 
                value={currentLang} 
                onChange={(e) => {
                  setCurrentLang(e.target.value);
                  addLog('SYS', `STT Locale switched to: ${e.target.value.toUpperCase()}`);
                }}
                className="bg-black/50 border border-white/10 p-2 rounded text-white outline-none"
              >
                <option value="en-US">English (United States)</option>
                <option value="ur-PK">Urdu / اردو (Pakistan)</option>
                <option value="en-GB">English (United Kingdom)</option>
              </select>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── MODAL: SECURITY CONFIRMATION GATE ── */}
      {confirmGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-[500px] glass-panel glass-panel-orange p-5 flex flex-col gap-4 font-mono text-xs"
          >
            <div className="flex items-center gap-2 border-b border-[rgba(255,184,77,0.15)] pb-2">
              <Shield className="text-[#ffb84d] w-6 h-6 animate-pulse" />
              <h3 className="text-white text-sm font-semibold tracking-wider">PRIVILEGED SYSTEM AUTHORIZATION REQUEST</h3>
            </div>
            
            <div className="flex flex-col gap-1">
              <span className="text-[#ffb84d]">TOOL NAME:</span>
              <span className="text-white bg-black/40 p-2 rounded border border-white/5">{confirmGate.tool}</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[#ffb84d]">PROPOSED SCOPE:</span>
              <pre className="text-white bg-black/40 p-2 rounded border border-white/5 overflow-x-auto text-[0.7rem] max-h-[140px]">
                {confirmGate.scope}
              </pre>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[#ffb84d]">ORCHESTRATOR RATIONALE:</span>
              <span className="text-[#ffffff] leading-relaxed italic">"{confirmGate.rationale}"</span>
            </div>

            <div className="flex gap-3 justify-end mt-2">
              <button 
                onClick={() => handleAuthDecision(false)}
                className="border border-[#ff4d4d]/30 text-[#ff4d4d] hover:bg-[#ff4d4d]/10 px-4 py-2 rounded font-semibold transition-all"
              >
                ABORT ACTION
              </button>
              <button 
                onClick={() => handleAuthDecision(true)}
                className="bg-[#33ff99]/15 border border-[#33ff99] text-[#33ff99] hover:bg-[#33ff99]/30 px-5 py-2 rounded font-semibold transition-all shadow-md"
              >
                AUTHORIZE RUN
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
