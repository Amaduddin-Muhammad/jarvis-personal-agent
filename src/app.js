// HUD state variables
let socket = null;
let reconnectInterval = 3000;
let audioMode = 'AWAKE'; // 'MUTED' | 'AWAKE'
let recognition = null;
let speechSynth = window.speechSynthesis;
let activeUtterance = null;
let currentLanguage = 'en-US';

// Voice engine advanced state
let vadTimer = null;                   // VAD silence timer
let interimTranscript = '';            // Currently accumulating interim text
let isMicDucked = false;               // Mic paused while JARVIS speaks
let recognitionRunning = false;        // Tracks if recognition is active
let preferredVoice = null;             // Best TTS voice, resolved on load
let voiceSpeed = 1.05;
let voicePitch = 0.95;
const VAD_SILENCE_MS = 1200;           // ms of silence before auto-send
const FILLER_WORDS = new Set(['um','uh','hmm','hm','ah','er','uhh','umm','mm']);
const MIN_CONFIDENCE = 0.40;           // Reject transcripts below this confidence

// DOM Elements
const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');
const btnAudioToggle = document.getElementById('btn-audio-toggle');
const btnClearChat = document.getElementById('btn-clear-chat');
const chatMessages = document.getElementById('chat-messages');
const consoleForm = document.getElementById('console-form');
const consoleInput = document.getElementById('console-input');
const actionLogs = document.getElementById('action-logs');
const logCountEl = document.getElementById('log-count');
const memoryList = document.getElementById('memory-list');

// Waveform canvas
let waveformCanvas = document.getElementById('waveform-canvas');
let ctx = waveformCanvas.getContext('2d');
let waveAnimationId = null;
let wavePhase = 0;

// Vitals DOM elements
const cpuPercent = document.getElementById('cpu-percent');
const cpuBar = document.getElementById('cpu-bar');
const ramPercent = document.getElementById('ram-percent');
const ramBar = document.getElementById('ram-bar');
const batPercent = document.getElementById('bat-percent');
const batBar = document.getElementById('bat-bar');
const netUp = document.getElementById('net-up');
const netDown = document.getElementById('net-down');
const processTableBody = document.getElementById('process-table-body');

// Confirmation Modal DOM
const confirmModal = document.getElementById('confirm-modal');
const confirmAction = document.getElementById('confirm-action');
const confirmScope = document.getElementById('confirm-scope');
const confirmRationale = document.getElementById('confirm-rationale');
const btnModalConfirm = document.getElementById('modal-btn-confirm');
const btnModalCancel = document.getElementById('modal-btn-cancel');

// Current confirmation pending promise resolver
let pendingConfirmationResolver = null;

// Initialize canvas size
function resizeCanvas() {
  waveformCanvas.width = waveformCanvas.parentElement.clientWidth;
  waveformCanvas.height = waveformCanvas.parentElement.clientHeight - 10;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Time display updater
setInterval(() => {
  const now = new Date();
  document.getElementById('current-time').innerText = now.toTimeString().split(' ')[0];
}, 1000);

// ==========================================
// ELECTRON WINDOW CONTROLS
// ==========================================
if (window.electronAPI) {
  btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
  btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
  btnClose.addEventListener('click', () => window.electronAPI.close());
} else {
  // Web preview fallback
  btnMinimize.style.display = 'none';
  btnMaximize.style.display = 'none';
  btnClose.style.display = 'none';
  console.log("Not running in Electron context");
}

// ==========================================
// WEBSOCKETS COMMUNICATION
// ==========================================
function connectWebSocket() {
  socket = new WebSocket('ws://localhost:8000/ws');

  socket.onopen = () => {
    addSystemLog('SYS', 'Secure handshake established with Python Core Server.');
    document.getElementById('system-status').innerText = 'ONLINE';
    document.getElementById('system-status').className = 'value ok-blink';
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
      case 'vitals':
        updateVitals(data.data);
        break;
      case 'agent_response':
        renderAgentResponse(data.content || data.speak_text, data.speak_text);
        setAgentState('IDLE');
        break;
      case 'require_confirmation':
        showConfirmationGate(data.id, data.tool, data.scope, data.rationale);
        break;
      case 'log':
        addSystemLog(data.level || 'INFO', data.message);
        break;
      case 'memory':
        updateMemoryViewer(data.facts);
        break;
      case 'step':
        addThoughtStep(data.step_num, data.kind, data.content);
        break;
      case 'agent_state':
        setAgentState(data.state);
        break;
      case 'proactive_alert':
        showProactiveToast(data.title, data.message, data.speak);
        break;
      default:
        console.log("Unhandled message type", data);
    }
  };

  socket.onclose = () => {
    addSystemLog('WARN', 'Connection lost. Retrying backend sync in 3s...');
    document.getElementById('system-status').innerText = 'OFFLINE';
    document.getElementById('system-status').className = 'value danger-color';
    setTimeout(connectWebSocket, reconnectInterval);
  };

  socket.onerror = (err) => {
    console.error("Socket error", err);
  };
}

connectWebSocket();

// ==========================================
// AGENT STATE INDICATOR
// ==========================================
function setAgentState(state) {
  const el = document.getElementById('agent-state');
  if (!el) return;
  const stateMap = {
    'IDLE':     { text: '◉ IDLE',     cls: 'idle-color' },
    'THINKING': { text: '◈ THINKING', cls: 'think-color' },
    'ACTING':   { text: '⚙ ACTING',   cls: 'act-color' },
    'SPEAKING': { text: '◆ SPEAKING', cls: 'speak-color' },
  };
  const s = stateMap[state] || stateMap['IDLE'];
  el.textContent = s.text;
  el.className = `value ${s.cls}`;
}

// ==========================================
// THOUGHT CHAIN PANEL
// ==========================================
let thoughtChainCollapsed = false;

function toggleThoughtChain() {
  const steps = document.getElementById('thought-chain-steps');
  const btn = document.getElementById('thought-chain-toggle');
  thoughtChainCollapsed = !thoughtChainCollapsed;
  steps.classList.toggle('collapsed', thoughtChainCollapsed);
  btn.textContent = thoughtChainCollapsed ? '▶ EXPAND' : '▼ COLLAPSE';
}

function addThoughtStep(stepNum, kind, content) {
  const container = document.getElementById('thought-chain-steps');
  if (!container) return;

  // On first step of a new query, clear old steps
  if (stepNum === 1 && kind === 'think') {
    container.innerHTML = '';
  }

  const kindLabel = { think: '🧠 THINK', act: '⚙ ACT', observe: '👁 OBSERVE' };
  const kindClass = { think: 'think-step', act: 'act-step', observe: 'observe-step' };

  const div = document.createElement('div');
  div.className = `thought-step ${kindClass[kind] || ''}`;
  div.textContent = `[${kindLabel[kind] || kind.toUpperCase()} #${stepNum}] ${content}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // Auto-expand if collapsed
  if (thoughtChainCollapsed) toggleThoughtChain();
}

// ==========================================
// PROACTIVE ALERT TOAST
// ==========================================
function showProactiveToast(title, message, speakText) {
  const toast = document.getElementById('proactive-toast');
  document.getElementById('toast-header').textContent = title;
  document.getElementById('toast-body').textContent = message;
  toast.classList.remove('hidden');
  // Speak the alert
  if (speakText && audioMode !== 'MUTED') {
    speakText_fn(speakText);
  }
  // Auto-dismiss after 12 seconds
  setTimeout(dismissToast, 12000);
}

function dismissToast() {
  const toast = document.getElementById('proactive-toast');
  if (toast) toast.classList.add('hidden');
}

// Alias speakText for use in proactive alerts
function speakText_fn(text) {
  speakText(text);
}



// ==========================================
// TTS — PREMIUM VOICE SELECTION
// ==========================================
function resolveBestVoice() {
  const voices = speechSynth.getVoices();
  if (!voices.length) return null;
  // Priority order: best online voices first, fallback to offline
  const priorities = [
    v => v.name === 'Google UK English Male',
    v => v.name === 'Google UK English Female',
    v => v.name === 'Google US English',
    v => v.name.includes('Google') && v.lang.startsWith('en'),
    v => v.name === 'Microsoft David - English (United States)',
    v => v.name === 'Microsoft Zira - English (United States)',
    v => v.name.includes('Natural') && v.lang.startsWith('en'),
    v => v.lang.startsWith('en') && !v.localService,
    v => v.lang.startsWith('en'),
  ];
  for (const test of priorities) {
    const found = voices.find(test);
    if (found) return found;
  }
  return voices[0] || null;
}

speechSynth.onvoiceschanged = () => {
  preferredVoice = resolveBestVoice();
  if (preferredVoice) {
    addSystemLog('OK', `TTS voice locked: ${preferredVoice.name}`);
    document.getElementById('lang-status').innerText = preferredVoice.name.replace('Google ', '').replace('Microsoft ', '');
  }
};
// Eagerly resolve in case voices already loaded
preferredVoice = resolveBestVoice();

function speakText(text) {
  if (audioMode === 'MUTED') return;
  if (!text || !text.trim()) return;

  // Strip markdown code blocks for TTS
  text = text.replace(/```[\s\S]*?```/g, ', code snippet,');
  // Strip markdown bold/italic markers
  text = text.replace(/[*_`#>]/g, '');
  // Trim to 300 chars max for voice — keeps it snappy
  if (text.length > 300) text = text.substring(0, 297) + '...';

  speechSynth.cancel();

  activeUtterance = new SpeechSynthesisUtterance(text);
  activeUtterance.voice = preferredVoice || resolveBestVoice();
  activeUtterance.rate  = voiceSpeed;
  activeUtterance.pitch = voicePitch;
  activeUtterance.lang  = currentLanguage;

  activeUtterance.onstart = () => {
    setAgentState('SPEAKING');
    // Duck mic: pause recognition while speaking to prevent feedback
    duckMic(true);
    addSystemLog('SYS', 'JARVIS speaking — mic ducked.');
  };

  activeUtterance.onend = () => {
    activeUtterance = null;
    setAgentState('IDLE');
    // Unduck mic: resume recognition after speaking
    duckMic(false);
    addSystemLog('MIC', 'Speech complete — mic resumed.');
  };

  activeUtterance.onerror = (e) => {
    console.error('TTS error:', e);
    activeUtterance = null;
    setAgentState('IDLE');
    duckMic(false);
  };

  speechSynth.speak(activeUtterance);
}

// ==========================================
// VOICE RECOGNITION — WORLD-CLASS ENGINE
// ==========================================

// Duck/unduck microphone during TTS playback
function duckMic(shouldDuck) {
  if (shouldDuck && !isMicDucked) {
    isMicDucked = true;
    if (recognition && recognitionRunning) {
      try { recognition.abort(); } catch(e) {}
      recognitionRunning = false;
    }
  } else if (!shouldDuck && isMicDucked) {
    isMicDucked = false;
    if (audioMode === 'AWAKE') {
      // Short delay so mic doesn't catch the tail of TTS audio
      setTimeout(startRecognition, 400);
    }
  }
}

function startRecognition() {
  if (isMicDucked || audioMode !== 'AWAKE' || recognitionRunning) return;
  try {
    recognition.start();
    recognitionRunning = true;
  } catch(e) {
    // already running — ignore
  }
}

function stopRecognition() {
  try { recognition.abort(); } catch(e) {}
  recognitionRunning = false;
}

function setAudioMode(mode) {
  audioMode = mode;

  if (mode === 'MUTED') {
    btnAudioToggle.innerText = 'MUTED';
    btnAudioToggle.className = 'hud-btn glow-btn btn-danger';
    speechSynth.cancel();
    stopRecognition();
    isMicDucked = false;
    clearInterimDisplay();
    document.getElementById('mic-status').innerText = '○ MUTED';
    document.getElementById('mic-status').className = 'value muted-color';
    addSystemLog('SYS', 'Voice engine offline — all loops disarmed.');
  } else if (mode === 'AWAKE') {
    btnAudioToggle.innerText = 'LISTENING';
    btnAudioToggle.className = 'hud-btn glow-btn btn-ok';
    document.getElementById('mic-status').innerText = '● LIVE';
    document.getElementById('mic-status').className = 'value live-color';
    addSystemLog('MIC', 'Voice engine ACTIVE — always listening.');
    startRecognition();
  }
}

// Show/hide the live interim transcript bar
function showInterimDisplay(text) {
  const el = document.getElementById('interim-transcript');
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    clearInterimDisplay();
  }
}

function clearInterimDisplay() {
  interimTranscript = '';
  const el = document.getElementById('interim-transcript');
  if (el) {
    el.textContent = '';
    el.classList.add('hidden');
  }
  if (vadTimer) {
    clearTimeout(vadTimer);
    vadTimer = null;
  }
}

function commitTranscript(text) {
  clearInterimDisplay();
  if (!text || text.trim().length < 2) return;

  // Barge-in: interrupt JARVIS if it is currently speaking
  if (speechSynth.speaking) {
    speechSynth.cancel();
    duckMic(false);
    addSystemLog('SYS', 'Barge-in: interrupting JARVIS speech.');
  }

  addSystemLog('MIC', `Committed: "${text}"`);
  renderUserMessage(text);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'user_message',
      content: text,
      is_voice: true
    }));
    setAgentState('THINKING');
  } else {
    addSystemLog('ERROR', 'WebSocket offline — cannot send voice query.');
  }
}

function isFillerOnly(text) {
  const words = text.toLowerCase().trim().split(/\s+/);
  return words.every(w => FILLER_WORDS.has(w));
}

async function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    addSystemLog('ERROR', 'Web Speech API not supported in this browser.');
    return;
  }

  // Request microphone access — needed for visualizer AND recognition
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    await initAudioVisualizer(micStream);
    addSystemLog('OK', 'Microphone access granted.');
  } catch (e) {
    addSystemLog('WARN', `Microphone access error: ${e.message}`);
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous      = true;    // Keep running permanently
  recognition.interimResults  = true;    // Stream results as they come
  recognition.maxAlternatives = 1;
  recognition.lang            = currentLanguage;

  recognition.onstart = () => {
    recognitionRunning = true;
    document.getElementById('mic-status').innerText = '● LIVE';
    document.getElementById('mic-status').className = 'value live-color';
  };

  recognition.onresult = (event) => {
    let interimText  = '';
    let finalText    = '';
    let bestConfidence = 1.0;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const transcript = res[0].transcript.trim();

      if (res.isFinal) {
        finalText     += transcript + ' ';
        bestConfidence = res[0].confidence || 1.0;
      } else {
        interimText += transcript;
      }
    }

    // ── Show interim transcript live ──
    if (interimText) {
      interimTranscript = interimText;
      showInterimDisplay('▶ ' + interimText);

      // VAD: reset the 1.2s silence timer on every new interim result
      if (vadTimer) clearTimeout(vadTimer);
      vadTimer = setTimeout(() => {
        // Silence detected — commit whatever we have
        const toSend = (interimTranscript || '').trim();
        if (toSend.length >= 2 && !isFillerOnly(toSend)) {
          commitTranscript(toSend);
        } else {
          clearInterimDisplay();
        }
      }, VAD_SILENCE_MS);
    }

    // ── Process final results ──
    if (finalText.trim()) {
      const clean = finalText.trim();

      // Cancel VAD timer — we have a firm final result
      if (vadTimer) { clearTimeout(vadTimer); vadTimer = null; }
      clearInterimDisplay();

      // Confidence gate
      if (bestConfidence < MIN_CONFIDENCE) {
        addSystemLog('WARN', `Low confidence (${(bestConfidence*100).toFixed(0)}%) — discarded: "${clean}"`);
        return;
      }

      // Filler-word gate
      if (isFillerOnly(clean)) {
        addSystemLog('MIC', `Filler detected — ignored: "${clean}"`);
        return;
      }

      const lower = clean.toLowerCase();

      // ── Built-in voice commands ──
      if (lower.includes('go to sleep') || lower.includes('sleep mode') || lower.includes('stand down')) {
        setAudioMode('MUTED');
        speakText('Understood. Going silent.');
        addSystemLog('SYS', 'Sleep command detected.');
        return;
      }
      if ((lower.includes('wake up') || lower.includes('unmute') || lower.includes('listen')) && audioMode === 'MUTED') {
        setAudioMode('AWAKE');
        speakText("I'm back. What do you need?");
        return;
      }

      commitTranscript(clean);
    }
  };

  recognition.onerror = (event) => {
    recognitionRunning = false;
    // 'no-speech' is normal — don't spam the log
    if (event.error === 'no-speech') return;
    // 'aborted' is triggered by our own duckMic() — ignore
    if (event.error === 'aborted') return;
    addSystemLog('WARN', `Voice recognition error: ${event.error}`);
  };

  recognition.onend = () => {
    recognitionRunning = false;
    // Auto-restart unless muted or mic is ducked
    if (audioMode === 'AWAKE' && !isMicDucked) {
      setTimeout(startRecognition, 150); // brief pause to avoid instant-restart loop
    } else {
      document.getElementById('mic-status').innerText = audioMode === 'MUTED' ? '○ MUTED' : '● STANDBY';
    }
  };

  // Boot into AWAKE immediately
  setAudioMode('AWAKE');
  speakText('JARVIS online. Voice control active.');
}

initSpeechRecognition();

// Toggle: AWAKE ↔ MUTED
btnAudioToggle.addEventListener('click', () => {
  if (audioMode === 'MUTED') {
    setAudioMode('AWAKE');
    speakText('Listening.');
  } else {
    setAudioMode('MUTED');
  }
});

// ==========================================
// HUD RENDER AND CHAT LOGS
// ==========================================
function renderUserMessage(text) {
  const timestamp = new Date().toLocaleTimeString();
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg user';
  msgDiv.innerHTML = `
    <span class="timestamp">[${timestamp}] OWNER</span>
    <div class="content">${escapeHtml(text)}</div>
  `;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderAgentResponse(content, speakTextContent) {
  const timestamp = new Date().toLocaleTimeString();
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg agent';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content typewriter-cursor';
  
  msgDiv.innerHTML = `<span class="timestamp">[${timestamp}] JARVIS</span>`;
  msgDiv.appendChild(contentDiv);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Animate typewriter reveal
  let i = 0;
  function typeWriter() {
    if (i < content.length) {
      contentDiv.innerHTML += content.charAt(i);
      i++;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      setTimeout(typeWriter, 12);
    } else {
      contentDiv.className = 'content'; // Remove cursor
    }
  }

  typeWriter();

  // Speak response if live mic enabled
  if (speakTextContent) {
    speakText(speakTextContent);
  } else {
    speakText(content.replace(/```[\s\S]*?```/g, "[code snippet]").substring(0, 150));
  }
}

function addSystemLog(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const logRow = document.createElement('div');
  logRow.className = 'log-row';
  
  let tagClass = 'info-tag';
  if (level === 'OK') tagClass = 'ok-tag';
  if (level === 'WARN') tagClass = 'warn-tag';
  if (level === 'ERROR') tagClass = 'error-tag';
  if (level === 'MIC') tagClass = 'info-tag';
  
  logRow.innerHTML = `
    <span class="time">[${timestamp}]</span> 
    <span class="tag ${tagClass}">[${level}]</span> 
    <span class="desc">${escapeHtml(message)}</span>
  `;
  
  actionLogs.appendChild(logRow);
  actionLogs.scrollTop = actionLogs.scrollHeight;

  // Update counts
  const rowCount = actionLogs.getElementsByClassName('log-row').length;
  logCountEl.innerText = `${rowCount} ENTRIES`;
}

function updateVitals(vitals) {
  // Update CPU
  cpuPercent.innerText = `${vitals.cpu}%`;
  cpuBar.style.width = `${vitals.cpu}%`;
  
  // Update RAM
  ramPercent.innerText = `${vitals.ram}%`;
  ramBar.style.width = `${vitals.ram}%`;

  // Update Battery
  batPercent.innerText = `${vitals.battery}%`;
  batBar.style.width = `${vitals.battery}%`;

  // Network speeds
  netUp.innerText = `${vitals.network.sent_mb.toFixed(2)} MB/s`;
  netDown.innerText = `${vitals.network.recv_kb.toFixed(1)} KB/s`;

  // Processes Table
  processTableBody.innerHTML = '';
  vitals.processes.slice(0, 8).forEach(proc => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(proc.name)}</td>
      <td style="text-align: right;" class="info-color">${proc.cpu.toFixed(1)}</td>
      <td style="text-align: right;">${proc.memory.toFixed(1)}</td>
    `;
    processTableBody.appendChild(row);
  });
}

function updateMemoryViewer(facts) {
  memoryList.innerHTML = '';
  if (!facts || facts.length === 0) {
    memoryList.innerHTML = '<div class="empty-memory">No recall history in vector core.</div>';
    return;
  }
  facts.forEach(fact => {
    const item = document.createElement('div');
    item.className = 'memory-fact';
    item.innerText = fact;
    memoryList.appendChild(item);
  });
}

// ==========================================
// CONFIRMATION GATE MODAL
// ==========================================
function showConfirmationGate(confirmId, tool, scope, rationale) {
  confirmAction.innerText = tool;
  confirmScope.innerText = scope;
  confirmRationale.innerText = rationale || 'Requested by system orchestrator.';
  
  // Unhide modal
  confirmModal.classList.remove('hidden');
  
  // Active permission indicators
  document.getElementById('perm-2').className = 'perm-level warn-led active';
  
  // Speak prompt
  speakText(`Action authorization required. I need permission to execute ${tool}. Please authorize.`);

  pendingConfirmationResolver = (approved) => {
    confirmModal.classList.add('hidden');
    document.getElementById('perm-2').className = 'perm-level warn-led';
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'confirm_response',
        confirm_id: confirmId,
        approved: approved
      }));
    }
    pendingConfirmationResolver = null;
  };
}

btnModalConfirm.addEventListener('click', () => {
  if (pendingConfirmationResolver) pendingConfirmationResolver(true);
});

btnModalCancel.addEventListener('click', () => {
  if (pendingConfirmationResolver) pendingConfirmationResolver(false);
});

// ==========================================
// DIRECT COMMAND LINE
// ==========================================
consoleForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const command = consoleInput.value.trim();
  if (!command) return;

  renderUserMessage(command);
  consoleInput.value = '';

  // Local CLI command overrides
  if (command.startsWith('/')) {
    handleLocalCommand(command);
    return;
  }

  // Send to socket
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'user_message',
      content: command,
      is_voice: false
    }));
  } else {
    addSystemLog('ERROR', 'Unable to transmit. Connection offline.');
  }
});

function handleLocalCommand(cmd) {
  const parts = cmd.trim().split(/\s+/);
  const base = parts[0].toLowerCase();

  if (base === '/clear') {
    chatMessages.innerHTML = '';
    addSystemLog('SYS', 'Console chat log purged.');

  } else if (base === '/help') {
    renderAgentResponse(
      `## JARVIS Local Command Reference\n\n` +
      `| Command | Description |\n|---|---|\n` +
      `| \`/clear\` | Purge chat log |\n` +
      `| \`/mute\` | Toggle mic LISTEN ↔ MUTE |\n` +
      `| \`/lang [code]\` | Change speech locale (e.g. \`en-GB\`, \`ur-PK\`) |\n` +
      `| \`/voice speed [0.5–2.0]\` | Set TTS playback speed |\n` +
      `| \`/voice pitch [0.5–2.0]\` | Set TTS pitch |\n` +
      `| \`/vad [ms]\` | Set VAD silence timeout in ms (default 1200) |\n` +
      `| \`/help\` | Show this reference |`,
      null
    );

  } else if (base === '/mute') {
    btnAudioToggle.click();

  } else if (base === '/lang') {
    const code = parts[1] || 'en-US';
    currentLanguage = code;
    if (recognition) {
      recognition.lang = currentLanguage;
      stopRecognition();
      setTimeout(startRecognition, 200);
    }
    document.getElementById('lang-status').innerText = code.toUpperCase();
    addSystemLog('SYS', `Recognition locale set to: ${code}`);

  } else if (base === '/voice') {
    const sub = (parts[1] || '').toLowerCase();
    const val = parseFloat(parts[2]);

    if (sub === 'speed' && !isNaN(val)) {
      voiceSpeed = Math.max(0.5, Math.min(2.0, val));
      addSystemLog('SYS', `TTS speed set to ${voiceSpeed.toFixed(2)}x`);
      speakText(`Speed set to ${voiceSpeed.toFixed(1)}x`);
    } else if (sub === 'pitch' && !isNaN(val)) {
      voicePitch = Math.max(0.5, Math.min(2.0, val));
      addSystemLog('SYS', `TTS pitch set to ${voicePitch.toFixed(2)}`);
      speakText(`Pitch adjusted.`);
    } else {
      addSystemLog('WARN', 'Usage: /voice speed [0.5-2.0]  or  /voice pitch [0.5-2.0]');
    }

  } else if (base === '/vad') {
    const ms = parseInt(parts[1]);
    if (!isNaN(ms) && ms >= 300 && ms <= 5000) {
      VAD_SILENCE_MS_dynamic = ms;
      addSystemLog('SYS', `VAD silence timeout set to ${ms}ms`);
    } else {
      addSystemLog('WARN', 'Usage: /vad [300–5000]  (milliseconds)');
    }

  } else {
    addSystemLog('WARN', `Unknown local command: ${base}. Type /help for reference.`);
  }
}

btnClearChat.addEventListener('click', () => {
  chatMessages.innerHTML = '';
  addSystemLog('SYS', 'Conversation log cleared.');
});

// ==========================================
// REAL MICROPHONE AUDIO VISUALIZER
// (Web Audio API AnalyserNode — your actual voice)
// ==========================================

let audioContext = null;
let analyserNode = null;
let micSource = null;
let micStream = null;
let analyserData = null;

// TTS Oscillator to simulate speaking waveform during synthesis
let synthGainNode = null;
let synthOscillator = null;

async function initAudioVisualizer(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.82;
    analyserData = new Uint8Array(analyserNode.frequencyBinCount);

    micSource = audioContext.createMediaStreamSource(stream);
    micSource.connect(analyserNode);
    // NOTE: Do NOT connect analyserNode to destination — we don't want mic feedback through speakers.

    addSystemLog('OK', 'Real-time microphone audio visualizer armed.');
  } catch (e) {
    addSystemLog('WARN', `Audio visualizer init failed: ${e.message}`);
  }
}

function getAnalyserLevel() {
  // Returns 0.0–1.0 representing current mic/synth amplitude
  if (!analyserNode || !analyserData) return 0.05;
  analyserNode.getByteFrequencyData(analyserData);
  let sum = 0;
  for (let i = 0; i < analyserData.length; i++) {
    sum += analyserData[i];
  }
  const avg = sum / analyserData.length;
  return Math.min(avg / 128, 1.0);
}

function drawWaveform() {
  ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

  const width  = waveformCanvas.width;
  const height = waveformCanvas.height;
  const midY   = height / 2;

  // ── Determine amplitude source ──
  let amplitude;
  if (speechSynth.speaking) {
    // TTS speaking: animate with a rapid golden oscillation
    amplitude = (0.5 + 0.4 * Math.abs(Math.sin(wavePhase * 6))) * (height / 2.5);
    ctx.strokeStyle = '#ffb84d';
    ctx.shadowColor  = '#ffb84d';
  } else if (audioMode === 'MUTED') {
    // Flatline
    amplitude = 0.03 * (height / 2.5);
    ctx.strokeStyle = '#3d4a45';
    ctx.shadowColor  = '#3d4a45';
  } else {
    // Listening: use real analyser level
    const level = getAnalyserLevel();
    amplitude = (0.08 + level * 0.92) * (height / 2.5);
    ctx.strokeStyle = '#33ff99';
    ctx.shadowColor  = '#33ff99';
  }

  ctx.shadowBlur = 10;
  ctx.lineWidth  = 1.8;

  // ── Primary wave ──
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const a1 = (x / 40) + wavePhase;
    const a2 = (x / 22) - wavePhase * 1.4;
    const a3 = (x / 80) + wavePhase * 0.5;
    const envelope = Math.sin((x / width) * Math.PI);
    const y = midY + (Math.sin(a1) * 0.5 + Math.cos(a2) * 0.3 + Math.sin(a3) * 0.2) * amplitude * envelope;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── Secondary cyan ghost wave (only when listening) ──
  if (audioMode !== 'MUTED' && !speechSynth.speaking) {
    ctx.strokeStyle = '#3ad6ff';
    ctx.shadowColor  = '#3ad6ff';
    ctx.shadowBlur   = 4;
    ctx.lineWidth    = 0.8;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const a1 = (x / 30) - wavePhase;
      const a2 = (x / 15) + wavePhase * 0.8;
      const envelope = Math.sin((x / width) * Math.PI);
      const level = getAnalyserLevel();
      const amp2  = (0.06 + level * 0.7) * (height / 2.5);
      const y = midY + (Math.cos(a1) * 0.6 + Math.sin(a2) * 0.4) * amp2 * envelope;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Advance phase
  wavePhase += speechSynth.speaking ? 0.14 : (audioMode === 'MUTED' ? 0.015 : 0.07);

  waveAnimationId = requestAnimationFrame(drawWaveform);
}

drawWaveform();


// Helper escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}
