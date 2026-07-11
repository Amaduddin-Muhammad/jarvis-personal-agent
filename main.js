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

// Start all JARVIS backend services in the background
function startBackends() {
  console.log('Starting Python AI Core...');
  const pythonPath = path.join(__dirname, 'backend-ai-core', '.venv', 'Scripts', 'python.exe');
  const serverPath = path.join(__dirname, 'backend-ai-core', 'server.py');
  
  aiCoreProcess = spawn(pythonPath, [serverPath], {
    cwd: __dirname,
    shell: true,
  });

  aiCoreProcess.stdout.on('data', (data) => console.log(`[AI Core]: ${data}`));
  aiCoreProcess.stderr.on('data', (data) => console.error(`[AI Core Error]: ${data}`));

  console.log('Starting NestJS Gateway...');
  gatewayProcess = spawn('npm', ['run', 'start'], {
    cwd: path.join(__dirname, 'backend-gateway'),
    shell: true,
  });

  gatewayProcess.stdout.on('data', (data) => console.log(`[Gateway]: ${data}`));
  gatewayProcess.stderr.on('data', (data) => console.error(`[Gateway Error]: ${data}`));

  console.log('Starting Next.js Frontend...');
  frontendProcess = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, 'frontend'),
    shell: true,
  });

  frontendProcess.stdout.on('data', (data) => console.log(`[Frontend]: ${data}`));
  frontendProcess.stderr.on('data', (data) => console.error(`[Frontend Error]: ${data}`));
}

// Kill all spawned background processes and their children on Windows
function killBackends() {
  console.log('Stopping background services...');
  if (aiCoreProcess) {
    try { execSync(`taskkill /pid ${aiCoreProcess.pid} /T /F`); } catch (e) {}
  }
  if (gatewayProcess) {
    try { execSync(`taskkill /pid ${gatewayProcess.pid} /T /F`); } catch (e) {}
  }
  if (frontendProcess) {
    try { execSync(`taskkill /pid ${frontendProcess.pid} /T /F`); } catch (e) {}
  }
}

// Check if Next.js frontend is listening on port 3001
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    frame: false, // frameless HUD
    transparent: true, // transparent window for cyber glow and depth
    backgroundColor: '#00000000', // fully transparent background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'src', 'logo.ico')
  });

  // Load boot visualizer immediately
  mainWindow.loadFile(path.join(__dirname, 'src', 'boot.html'));

  // Start backends
  startBackends();

  // Redirect to HUD once front-end server is up
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

function createTray() {
  const iconPath = path.join(__dirname, 'src', 'tray_icon.png');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show HUD',
      click: () => mainWindow.show()
    },
    {
      label: 'Minimize to Tray',
      click: () => mainWindow.hide()
    },
    { type: 'separator' },
    {
      label: 'Quit JARVIS',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('JARVIS Personal AI Agent');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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

  // Register Alt+Space shortcut to toggle HUD
  globalShortcut.register('Alt+Space', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
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

// IPC handlers for window control
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
