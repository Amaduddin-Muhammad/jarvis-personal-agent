const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, session } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');

let mainWindow;
let tray;
let isQuitting = false;

// Background process handles
let aiCoreProcess = null;
let gatewayProcess = null;
let frontendProcess = null;

// ─────────────────────────────────────────────────────────────────
// PORT CLEANUP — kills ANY process occupying a port on Windows.
// This handles the EADDRINUSE case when a previous JARVIS session
// wasn't fully cleaned up before launching again.
// ─────────────────────────────────────────────────────────────────
function freePort(port) {
  try {
    // netstat finds the PID using the port; taskkill ends it forcefully
    const result = execSync(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!result) return;

    // Parse the PID from the last column of each matching line
    const pids = new Set();
    result.split('\n').forEach(line => {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    });

    pids.forEach(pid => {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        console.log(`[JARVIS] Freed port ${port} — killed PID ${pid}`);
      } catch (e) {
        // Process may have already exited — safe to ignore
      }
    });
  } catch (e) {
    // No process found on port — nothing to do
  }
}

// Free all ports JARVIS services use
function freeAllPorts() {
  console.log('[JARVIS] Cleaning up ports 3000, 3001, 8000...');
  freePort(3000); // NestJS Gateway
  freePort(3001); // Next.js Frontend
  freePort(8000); // Python AI Core
}

// ─────────────────────────────────────────────────────────────────
// BACKEND STARTUP
// ─────────────────────────────────────────────────────────────────
function startBackends() {
  console.log('[JARVIS] Starting Python AI Core...');
  const pythonPath = path.join(__dirname, 'backend-ai-core', '.venv', 'Scripts', 'python.exe');
  const serverPath = path.join(__dirname, 'backend-ai-core', 'server.py');

  aiCoreProcess = spawn(pythonPath, [serverPath], {
    cwd: __dirname,
    shell: true,
  });

  aiCoreProcess.stdout.on('data', (data) => console.log(`[AI Core]: ${data}`));
  aiCoreProcess.stderr.on('data', (data) => console.error(`[AI Core Error]: ${data}`));

  console.log('[JARVIS] Starting NestJS Gateway...');
  gatewayProcess = spawn('npm', ['run', 'start'], {
    cwd: path.join(__dirname, 'backend-gateway'),
    shell: true,
  });

  gatewayProcess.stdout.on('data', (data) => console.log(`[Gateway]: ${data}`));
  gatewayProcess.stderr.on('data', (data) => console.error(`[Gateway Error]: ${data}`));

  console.log('[JARVIS] Starting Next.js Frontend...');
  frontendProcess = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, 'frontend'),
    shell: true,
  });

  frontendProcess.stdout.on('data', (data) => console.log(`[Frontend]: ${data}`));
  frontendProcess.stderr.on('data', (data) => console.error(`[Frontend Error]: ${data}`));
}

// ─────────────────────────────────────────────────────────────────
// BACKEND SHUTDOWN — kills tracked PIDs AND re-frees ports
// ─────────────────────────────────────────────────────────────────
function killBackends() {
  console.log('[JARVIS] Stopping background services...');

  const kill = (proc, label) => {
    if (!proc) return;
    try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    console.log(`[JARVIS] ${label} stopped.`);
  };

  kill(aiCoreProcess, 'AI Core');
  kill(gatewayProcess, 'Gateway');
  kill(frontendProcess, 'Frontend');

  // Belt-and-suspenders: also free ports in case child processes survived
  freeAllPorts();
}

// ─────────────────────────────────────────────────────────────────
// FRONTEND READINESS POLL
// ─────────────────────────────────────────────────────────────────
function checkFrontendReady(callback) {
  const req = http.get('http://localhost:3001', (res) => {
    if (res.statusCode === 200) {
      callback();
    } else {
      setTimeout(() => checkFrontendReady(callback), 500);
    }
  });

  req.on('error', () => {
    setTimeout(() => checkFrontendReady(callback), 500);
  });
}

// ─────────────────────────────────────────────────────────────────
// WINDOW CREATION
// ─────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'src', 'logo.ico'),
  });

  // Load boot screen immediately
  mainWindow.loadFile(path.join(__dirname, 'src', 'boot.html'));

  // Free lingering ports FIRST, then start backends
  freeAllPorts();
  startBackends();

  // Navigate to HUD once Next.js is ready
  checkFrontendReady(() => {
    if (mainWindow) {
      mainWindow.loadURL('http://localhost:3001');
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────────────────────────
// TRAY SETUP
// ─────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'src', 'tray_icon.png');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show HUD',
      click: () => mainWindow && mainWindow.show(),
    },
    {
      label: 'Minimize to Tray',
      click: () => mainWindow && mainWindow.hide(),
    },
    { type: 'separator' },
    {
      label: 'Quit JARVIS',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('JARVIS Personal AI Agent');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createTray();

  // Auto-approve microphone permission requests
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  // Alt+Space — toggle HUD visibility
  globalShortcut.register('Alt+Space', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  killBackends();
});

// ─────────────────────────────────────────────────────────────────
// IPC HANDLERS — window chrome controls
// ─────────────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('app-quit', () => {
  isQuitting = true;
  app.quit();
});
