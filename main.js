const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let tray;
let isQuitting = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false, // frameless HUD
    transparent: true, // transparent window for cyber glow and depth
    backgroundColor: '#00000000', // fully transparent background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'src', 'logo.png') // fallback if no logo
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window close by hiding instead (running in background)
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
  // Create a simple blank tray icon if no image exists, or a green circle icon
  // For Windows, we can use a small green dot icon
  const iconPath = path.join(__dirname, 'src', 'tray_icon.png');
  
  // Note: If icon doesn't exist, Electron might show empty tray. We'll handle it.
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

  // Toggle HUD window on tray click
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

  // Auto-approve microphone permission requests for Web Speech API
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'media') return true;
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
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
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// IPC handlers for window control (minimize, maximize, close)
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
  if (mainWindow) mainWindow.hide(); // Hide to tray instead of closing
});

ipcMain.on('app-quit', () => {
  isQuitting = true;
  app.quit();
});
