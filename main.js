'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const {
  convertedName,
  find3mfArgument,
  is3mfPath,
  isConvertedPath,
  isExecutablePath,
  orcaCandidatePaths,
  portableExecutablePath,
  sanitizeBaseName,
  uniquePath,
} = require('./main-utils');

const APP_NAME = 'Tridibox 3MF to U1';
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_SETTINGS = {
  watchEnabled: false,
  watchFolder: path.join(os.homedir(), 'Downloads'),
  startWithWindows: false,
  minimizeToTray: true,
  autoConvertSingleColor: false,
  defaultFilamentType: 'PLA',
  orcaExecutable: '',
};

app.setName(APP_NAME);
app.setAppUserModelId('com.tridibox.3mftou1');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');

let mainWindow = null;
let tray = null;
let folderWatcher = null;
let isQuitting = false;
let settings = { ...DEFAULT_SETTINGS };
let pendingOpenRequest = null;
const watchTimers = new Map();
const recentlyHandled = new Map();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    settings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  if (!settings.watchFolder || typeof settings.watchFolder !== 'string') {
    settings.watchFolder = DEFAULT_SETTINGS.watchFolder;
  }
}

async function persistSettings(next) {
  settings = { ...DEFAULT_SETTINGS, ...settings, ...next };
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fsp.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.startWithWindows),
    path: portableExecutablePath(process.env, process.execPath),
    args: ['--hidden'],
  });
  startFolderWatcher();
  createOrUpdateTray();
  return settings;
}

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 980,
    height: 780,
    minWidth: 780,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f7fb',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (show) mainWindow.show();
    if (pendingOpenRequest) {
      const request = pendingOpenRequest;
      pendingOpenRequest = null;
      sendFileToRenderer(request.filePath, request.source);
    }
  });

  mainWindow.on('close', event => {
    if (!isQuitting && settings.watchEnabled && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) createWindow(true);
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createOrUpdateTray() {
  if (!settings.watchEnabled) {
    if (tray) tray.destroy();
    tray = null;
    return;
  }

  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-32.png'));
    tray = new Tray(icon);
    tray.setToolTip(`${APP_NAME} — vigilancia activa`);
    tray.on('double-click', showWindow);
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir conversor', click: showWindow },
    { label: `Vigilando: ${settings.watchFolder}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

async function validate3mf(filePath) {
  if (!is3mfPath(filePath)) throw new Error('El archivo debe tener extensión .3mf.');
  const resolved = path.resolve(filePath);
  const stat = await fsp.stat(resolved);
  if (!stat.isFile()) throw new Error('La ruta seleccionada no es un archivo.');
  if (stat.size > MAX_FILE_BYTES) throw new Error('El archivo supera el límite de seguridad de 2 GB.');
  return { resolved, stat };
}

async function read3mf(filePath) {
  const { resolved } = await validate3mf(filePath);
  const data = await fsp.readFile(resolved);
  return {
    path: resolved,
    name: path.basename(resolved),
    data: new Uint8Array(data),
  };
}

async function existingExecutable(filePath) {
  if (!isExecutablePath(filePath)) return null;
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

async function findSnapmakerOrca() {
  const candidates = [
    settings.orcaExecutable,
    ...orcaCandidatePaths(process.env, os.homedir()),
  ];
  for (const candidate of candidates) {
    const executable = await existingExecutable(candidate);
    if (executable) return executable;
  }
  return null;
}

async function chooseSnapmakerOrca() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Ubicar Snapmaker Orca',
    properties: ['openFile'],
    filters: [{ name: 'Aplicación de Windows', extensions: ['exe'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const executable = await existingExecutable(result.filePaths[0]);
  if (!executable) throw new Error('El archivo seleccionado no es una aplicación .exe válida.');
  await persistSettings({ orcaExecutable: executable });
  return executable;
}

async function launchSnapmakerOrca(filePath) {
  const { resolved } = await validate3mf(filePath);
  const executable = await findSnapmakerOrca() || await chooseSnapmakerOrca();
  if (!executable) return { canceled: true };

  const child = spawn(executable, [resolved], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return { canceled: false, opened: true, executable };
}

async function sendFileToRenderer(filePath, source = 'watcher') {
  try {
    const payload = await read3mf(filePath);
    showWindow();
    if (mainWindow.webContents.isLoading()) {
      pendingOpenRequest = { filePath, source };
      return;
    }
    mainWindow.webContents.send('desktop:file-opened', { ...payload, source });
  } catch (error) {
    showWindow();
    mainWindow?.webContents.send('desktop:file-error', error.message);
  }
}

function cleanupRecentlyHandled() {
  const cutoff = Date.now() - 120000;
  for (const [filePath, timestamp] of recentlyHandled) {
    if (timestamp < cutoff) recentlyHandled.delete(filePath);
  }
}

async function waitUntilStable(filePath) {
  let previousSize = -1;
  let stableChecks = 0;
  const started = Date.now();

  while (Date.now() - started < 60000) {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return false;
      if (stat.size > 0 && stat.size === previousSize) stableChecks += 1;
      else stableChecks = 0;
      previousSize = stat.size;
      if (stableChecks >= 2) return true;
    } catch {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  return false;
}

function scheduleWatchedFile(filePath) {
  if (!is3mfPath(filePath) || isConvertedPath(filePath)) return;
  cleanupRecentlyHandled();
  if (recentlyHandled.has(filePath)) return;
  clearTimeout(watchTimers.get(filePath));
  watchTimers.set(filePath, setTimeout(async () => {
    watchTimers.delete(filePath);
    if (await waitUntilStable(filePath)) {
      recentlyHandled.set(filePath, Date.now());
      sendFileToRenderer(filePath, 'watcher');
    }
  }, 500));
}

function stopFolderWatcher() {
  if (folderWatcher) folderWatcher.close();
  folderWatcher = null;
  for (const timer of watchTimers.values()) clearTimeout(timer);
  watchTimers.clear();
}

function startFolderWatcher() {
  stopFolderWatcher();
  if (!settings.watchEnabled) return;
  try {
    if (!fs.statSync(settings.watchFolder).isDirectory()) return;
    folderWatcher = fs.watch(settings.watchFolder, { persistent: true }, (_event, filename) => {
      if (!filename) return;
      scheduleWatchedFile(path.join(settings.watchFolder, filename.toString()));
    });
    folderWatcher.on('error', error => {
      mainWindow?.webContents.send('desktop:watch-error', error.message);
    });
  } catch (error) {
    mainWindow?.webContents.send('desktop:watch-error', error.message);
  }
}

function createIpcHandlers() {
  ipcMain.handle('desktop:get-info', () => ({
    appName: APP_NAME,
    version: app.getVersion(),
    settings,
  }));

  ipcMain.handle('desktop:choose-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar archivo 3MF',
      properties: ['openFile'],
      filters: [{ name: 'Archivos 3MF', extensions: ['3mf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return read3mf(result.filePaths[0]);
  });

  ipcMain.handle('desktop:read-file', (_event, filePath) => read3mf(filePath));

  ipcMain.handle('desktop:choose-watch-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Elegir carpeta para vigilar',
      defaultPath: settings.watchFolder,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('desktop:update-settings', async (_event, next) => {
    const allowed = {
      watchEnabled: Boolean(next.watchEnabled),
      watchFolder: typeof next.watchFolder === 'string' ? next.watchFolder : settings.watchFolder,
      startWithWindows: Boolean(next.startWithWindows),
      minimizeToTray: Boolean(next.minimizeToTray),
      autoConvertSingleColor: Boolean(next.autoConvertSingleColor),
      defaultFilamentType: ['PLA', 'PETG-HF', 'ABS', 'TPU'].includes(next.defaultFilamentType)
        ? next.defaultFilamentType
        : 'PLA',
    };
    if (allowed.watchEnabled) {
      const stat = await fsp.stat(allowed.watchFolder);
      if (!stat.isDirectory()) throw new Error('La carpeta seleccionada no es válida.');
    }
    return persistSettings(allowed);
  });

  ipcMain.handle('desktop:save-converted', async (_event, payload) => {
    const sourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath : null;
    const suggestedName = convertedName(payload.suggestedName || 'modelo');
    let targetPath;

    if (payload.automatic && sourcePath) {
      targetPath = uniquePath(path.join(path.dirname(sourcePath), suggestedName));
    } else {
      const defaultPath = sourcePath
        ? path.join(path.dirname(sourcePath), suggestedName)
        : path.join(app.getPath('downloads'), suggestedName);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar archivo convertido para U1',
        defaultPath,
        filters: [{ name: 'Archivo 3MF', extensions: ['3mf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      targetPath = result.filePath.toLowerCase().endsWith('.3mf') ? result.filePath : `${result.filePath}.3mf`;
    }

    const bytes = Buffer.from(payload.data);
    if (payload.automatic) {
      const temporary = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
      await fsp.writeFile(temporary, bytes, { flag: 'wx' });
      await fsp.rename(temporary, targetPath);
    } else {
      await fsp.writeFile(targetPath, bytes);
    }
    return { canceled: false, path: targetPath };
  });

  ipcMain.handle('desktop:save-original', async (_event, payload) => {
    const base = sanitizeBaseName(payload.suggestedName || 'modelo');
    const defaultPath = payload.sourcePath
      ? path.join(path.dirname(payload.sourcePath), `${base}-original.3mf`)
      : path.join(app.getPath('downloads'), `${base}-original.3mf`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar copia del archivo original',
      defaultPath,
      filters: [{ name: 'Archivo 3MF', extensions: ['3mf'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const targetPath = result.filePath.toLowerCase().endsWith('.3mf') ? result.filePath : `${result.filePath}.3mf`;
    await fsp.writeFile(targetPath, Buffer.from(payload.data));
    return { canceled: false, path: targetPath };
  });

  ipcMain.handle('desktop:open-in-orca', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('La ruta del archivo convertido no es válida.');
    }
    return launchSnapmakerOrca(filePath);
  });

  ipcMain.handle('desktop:show-in-folder', (_event, filePath) => {
    if (typeof filePath === 'string' && path.isAbsolute(filePath)) shell.showItemInFolder(filePath);
  });

}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = find3mfArgument(argv);
    if (filePath) sendFileToRenderer(filePath, 'argument');
    else showWindow();
  });

  app.whenReady().then(async () => {
    await loadSettings();
    createIpcHandlers();
    startFolderWatcher();
    createOrUpdateTray();

    const initialFile = find3mfArgument(process.argv);
    if (initialFile) pendingOpenRequest = { filePath: initialFile, source: 'argument' };
    const startHidden = process.argv.includes('--hidden') && settings.watchEnabled;
    createWindow(!startHidden);
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  stopFolderWatcher();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !(settings.watchEnabled && settings.minimizeToTray)) {
    app.quit();
  }
});

app.on('activate', showWindow);
