// HUD state variables
let socket = null;
let reconnectInterval = 3000;
let audioMode = 'STANDBY'; // 'MUTED' | 'STANDBY' | 'AWAKE'
let recognition = null;
let speechSynth = window.speechSynthesis;
let activeUtterance = null;
let currentLanguage = 'en-US';

// Waveform visualizer state
let waveformCanvas = document.getElementById('waveform-canvas');
let ctx = waveformCanvas.getContext('2d');
let waveAnimationId = null;
let wavePhase = 0;
let waveActivity = 0.05; // Base idle noise

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
// VOICE SYNTHESIS (TTS) & BARGE-IN
// ==========================================
function speakText(text) {
  if (audioMode === 'MUTED') return;

  // Interrupt previous speak
  speechSynth.cancel();
  waveActivity = 0.8; // Peak wave activity during speech

  activeUtterance = new SpeechSynthesisUtterance(text);
  
  // Set voice options
  const voices = speechSynth.getVoices();
  // Try to find a premium English voice or a default system voice
  let voice = voices.find(v => v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Haruka') || v.name.includes('David') || v.name.includes('Zira'));
  if (voice) {
    activeUtterance.voice = voice;
  }
  activeUtterance.rate = 1.05; // Slightly faster for responsiveness
  activeUtterance.pitch = 0.95; // Slightly lower for a calm baritone feel

  activeUtterance.onend = () => {
    waveActivity = (audioMode === 'MUTED') ? 0.05 : ((audioMode === 'STANDBY') ? 0.08 : 0.2); // Return to listening/idle noise
    activeUtterance = null;
  };

  activeUtterance.onerror = (e) => {
    console.error("Speech error", e);
    waveActivity = (audioMode === 'MUTED') ? 0.05 : ((audioMode === 'STANDBY') ? 0.08 : 0.2);
  };

  speechSynth.speak(activeUtterance);
}

// Make sure voices are loaded
speechSynth.onvoiceschanged = () => {
  console.log("Voices loaded:", speechSynth.getVoices().length);
};

// ==========================================
// VOICE RECOGNITION (STT)
// ==========================================
function setAudioMode(mode) {
  audioMode = mode;
  
  if (mode === 'MUTED') {
    btnAudioToggle.innerText = 'MUTED';
    btnAudioToggle.className = 'hud-btn glow-btn btn-danger';
    speechSynth.cancel();
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
    }
    document.getElementById('mic-status').innerText = '○ MUTED';
    document.getElementById('mic-status').className = 'value muted-color';
    waveActivity = 0.05;
    addSystemLog('SYS', 'Voice loops disarmed. Conversational flow offline.');
  } else if (mode === 'STANDBY') {
    btnAudioToggle.innerText = 'STANDBY';
    btnAudioToggle.className = 'hud-btn glow-btn btn-warning';
    document.getElementById('mic-status').innerText = '● STANDBY';
    document.getElementById('mic-status').className = 'value warning-color';
    waveActivity = 0.08;
    if (recognition) {
      try { recognition.start(); } catch(e) {}
    }
    addSystemLog('SYS', 'Voice loops in standby. Awaiting wake phrase "Wake up Jarvis".');
  } else if (mode === 'AWAKE') {
    btnAudioToggle.innerText = 'AWAKE';
    btnAudioToggle.className = 'hud-btn glow-btn btn-ok';
    document.getElementById('mic-status').innerText = '● LIVE';
    document.getElementById('mic-status').className = 'value live-color';
    waveActivity = 0.25;
    if (recognition) {
      try { recognition.start(); } catch(e) {}
    }
    addSystemLog('SYS', 'Voice loops active. Conversational flow online.');
  }
}

function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window)) {
    addSystemLog('ERROR', 'Webkit Speech Recognition is not supported in this environment.');
    return;
  }

  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = currentLanguage;

  recognition.onstart = () => {
    if (audioMode === 'STANDBY') {
      document.getElementById('mic-status').innerText = '● STANDBY';
      document.getElementById('mic-status').className = 'value warning-color';
      waveActivity = 0.08;
      addSystemLog('MIC', 'Microphone armed. Awaiting wake phrase "Wake up Jarvis".');
    } else if (audioMode === 'AWAKE') {
      document.getElementById('mic-status').innerText = '● LIVE';
      document.getElementById('mic-status').className = 'value live-color';
      waveActivity = 0.25;
      addSystemLog('MIC', 'Microphone active. Voice loop open.');
    }
  };

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    if (result.isFinal) {
      const speechText = result[0].transcript.trim();
      const lowerText = speechText.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
      
      if (audioMode === 'STANDBY') {
        if (lowerText.includes('wake up jarvis') || lowerText.includes('wake up')) {
          setAudioMode('AWAKE');
          addSystemLog('SYS', 'Wake word detected. Initializing JARVIS systems...');
          renderUserMessage(speechText);
          speakText("Systems operational. I am listening, sir.");
          renderAgentResponse("Systems operational. I am listening, sir.", "Systems operational. I am listening, sir.");
        }
        return;
      }
      
      if (lowerText === 'go to sleep' || lowerText === 'sleep' || lowerText === 'stand down') {
        setAudioMode('STANDBY');
        addSystemLog('SYS', 'Sleep word detected. Standing down...');
        renderUserMessage(speechText);
        speakText("Standing down. I am in standby mode.");
        renderAgentResponse("Standing down. I am in standby mode.", "Standing down. I am in standby mode.");
        return;
      }
      
      addSystemLog('MIC', `Transcribed: "${speechText}"`);
      
      // Interrupt check: if agent is currently speaking, barge-in!
      if (speechSynth.speaking) {
        speechSynth.cancel();
        addSystemLog('SYS', 'Barge-in detected: interrupting playback.');
      }

      // Render transcription in Chat HUD
      renderUserMessage(speechText);

      // Send to server
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'user_message',
          content: speechText,
          is_voice: true
        }));
      }
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') return;
    addSystemLog('WARN', `Speech recognition error: ${event.error}`);
  };

  recognition.onend = () => {
    if (audioMode !== 'MUTED') {
      try { recognition.start(); } catch (e) {}
    } else {
      document.getElementById('mic-status').innerText = '○ MUTED';
      document.getElementById('mic-status').className = 'value muted-color';
      waveActivity = 0.05;
    }
  };
  
  // Try to start on initialization
  try {
    recognition.start();
  } catch (e) {}
}

initSpeechRecognition();

// Cycle audio modes: STANDBY -> AWAKE -> MUTED -> STANDBY
btnAudioToggle.addEventListener('click', () => {
  if (audioMode === 'MUTED') {
    setAudioMode('STANDBY');
  } else if (audioMode === 'STANDBY') {
    setAudioMode('AWAKE');
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
  const parts = cmd.split(' ');
  const base = parts[0].toLowerCase();
  
  if (base === '/clear') {
    chatMessages.innerHTML = '';
    addSystemLog('SYS', 'Console chat log purged.');
  } else if (base === '/help') {
    renderAgentResponse("Available Local Commands:\n/clear - Purges conversational logs\n/mute - Toggles microphone state\n/lang [code] - Changes speech locale (e.g., en-US, es-ES)\n/vitals - Triggers force poll for vitals");
  } else if (base === '/mute') {
    btnAudioToggle.click();
  } else if (base === '/lang') {
    const code = parts[1] || 'en-US';
    currentLanguage = code;
    if (recognition) {
      recognition.lang = currentLanguage;
      if (!isAudioMuted) {
        recognition.stop(); // auto-restarts with new lang
      }
    }
    document.getElementById('lang-status').innerText = `AUTO (${code.toUpperCase()})`;
    addSystemLog('SYS', `Vocal recognition lang set to locale: ${code}`);
  } else {
    addSystemLog('WARN', `Unknown local instruction code: ${base}`);
  }
}

btnClearChat.addEventListener('click', () => {
  chatMessages.innerHTML = '';
  addSystemLog('SYS', 'Conversation log cleared.');
});

// ==========================================
// GLOWING AUDIO WAVEFORM CANVAS ANIMATION
// ==========================================
function drawWaveform() {
  ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  const midY = height / 2;
  
  // Dynamic wave parameters based on waveActivity
  // If speaking/hearing, height increases
  const amplitude = waveActivity * (height / 2.5);
  
  // Drawing parameters
  ctx.strokeStyle = '#33ff99';
  ctx.shadowColor = '#33ff99';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.5;
  
  // Draw primary phosphor wave
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    // Combine multiple sine waves for organic noise
    const angle1 = (x / 40) + wavePhase;
    const angle2 = (x / 20) - (wavePhase * 1.5);
    const angle3 = (x / 80) + (wavePhase * 0.5);
    
    // Wave envelope: flatten at boundaries
    const envelope = Math.sin((x / width) * Math.PI);
    
    const y = midY + (Math.sin(angle1) * 0.5 + Math.cos(angle2) * 0.3 + Math.sin(angle3) * 0.2) * amplitude * envelope;
    
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Draw secondary cyan wave (slightly out of phase, offset)
  ctx.strokeStyle = '#3ad6ff';
  ctx.shadowColor = '#3ad6ff';
  ctx.shadowBlur = 4;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const angle1 = (x / 30) - wavePhase;
    const angle2 = (x / 15) + (wavePhase * 0.8);
    const envelope = Math.sin((x / width) * Math.PI);
    
    const y = midY + (Math.cos(angle1) * 0.6 + Math.sin(angle2) * 0.4) * (amplitude * 0.7) * envelope;
    
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  
  // Advance phase
  wavePhase += isAudioMuted ? 0.02 : 0.08;
  
  // Dynamic decay to idle noise
  if (speechSynth.speaking) {
    waveActivity = 0.75;
  } else if (!isAudioMuted) {
    // Listening, small micro fluctuations
    waveActivity = 0.15 + Math.sin(wavePhase * 2) * 0.05;
  } else {
    // Flatline/idle
    waveActivity = 0.02;
  }
  
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
