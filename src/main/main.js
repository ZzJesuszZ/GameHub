const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, session, nativeImage, protocol, net } = require('electron');

// Permite usar otra carpeta de datos (útil para pruebas)
if (process.env.GAMEHUB_DATA) app.setPath('userData', process.env.GAMEHUB_DATA);
const settings = require('./settings');
const library = require('./library');
const artwork = require('./artwork');
const emulators = require('./emulators');
const { CONSOLES } = require('./consoles');
const { Gamepad, BUTTON_NAMES } = require('./gamepad');
const { Launcher } = require('./launcher');
const { setAutostart, bringToFront } = require('./autostart');
const pcgames = require('./pcgames');

// gamehub-img:// sirve (solo lectura) las carátulas que Steam ya guarda en el PC
protocol.registerSchemesAsPrivileged([
  { scheme: 'gamehub-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
const startHidden = process.argv.includes('--background');
const windowed = process.argv.includes('--windowed');
const show = (w) => bringToFront(w, !windowed);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && show(win));
  app.whenReady().then(init);
}

let win = null;
let tray = null;
let quitting = false;
const pad = new Gamepad();
const launcher = new Launcher();

function createWindow() {
  // Partición sin "persist:" => la caché HTTP (carátulas, fondos) vive solo en RAM
  const ses = session.fromPartition('gamehub');
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.protocol.handle('gamehub-img', (req) => {
    const file = artwork.localImagePath(req.url);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 });
  });

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: !windowed,
    frame: false,
    show: false,
    backgroundColor: '#07080c',
    icon: ICON,
    title: 'GameHub',
    webPreferences: {
      partition: 'gamehub',
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.once('ready-to-show', () => {
    if (!startHidden) show(win);
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  for (const ev of ['focus', 'blur', 'show', 'hide']) win.on(ev, updatePollRate);
}

// Con un juego de PC abierto se puede usar GameHub encima (el juego sigue en marcha)
const uiBlocked = () => launcher.running && !launcher.isPc;

function updatePollRate() {
  const active = win && win.isVisible() && win.isFocused() && !uiBlocked();
  pad.setRate(active ? 16 : 100);
  if (win && !win.isDestroyed()) win.webContents.send('app:active', active);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('GameHub — mantén el combo del mando (View + Menu / Share + Options) para abrir');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir GameHub', click: () => show(win) },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => show(win));
}

function configurePad() {
  const s = settings.load();
  pad.setCombo(s.combo, [s.comboHoldMs, s.comboQuitGameMs]);
}

function startGamepad() {
  try {
    configurePad();
    pad.start(100);
  } catch (err) {
    console.error('Mando no disponible:', err.message);
    return;
  }
  pad.on('button', (name) => {
    if (win.isVisible() && win.isFocused() && !uiBlocked()) win.webContents.send('pad:button', name);
  });
  pad.on('connection', (connected, names) => win.webContents.send('pad:connection', connected, names));
  pad.on('combo', (heldMs) => {
    const s = settings.load();
    if (launcher.isPc) {
      if (heldMs === s.comboHoldMs) show(win);
      return;
    }
    if (launcher.running) {
      if (heldMs === s.comboQuitGameMs) launcher.stop();
      return;
    }
    if (heldMs === s.comboHoldMs && !(win.isVisible() && win.isFocused())) show(win);
  });
}

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    settings: settings.load(),
    consoles: CONSOLES.map((c) => ({ ...c, icon: artwork.consoleIcon(c.id), ready: emulators.isReady(c) })),
    counts: library.counts(),
    emulators: emulators.status(),
    recent: library.recent(),
    padConnected: pad.connected,
    padNames: pad.names,
    buttons: BUTTON_NAMES,
    biosDir: emulators.biosDir(),
  }));

  ipcMain.handle('library:scan', () => library.scan());
  ipcMain.handle('library:list', (_e, consoleId) => library.list(consoleId));
  ipcMain.handle('library:favorite', (_e, romPath) => {
    const g = library.find(romPath);
    return g && library.update(romPath, { favorite: !g.favorite });
  });

  ipcMain.handle('artwork:resolve', (_e, consoleId, fileNames) => artwork.resolveMany(consoleId, fileNames, library.list('pc')));
  ipcMain.handle('artwork:consolePhotos', () => artwork.consolePhotos());
  ipcMain.handle('artwork:hero', (_e, title) => artwork.hero(title));

  ipcMain.handle('game:launch', async (_e, romPath) => {
    const game = library.find(romPath);
    if (!game) throw new Error('Juego no encontrado');
    await launcher.launch(game, pad.names);
    library.update(romPath, { lastPlayed: Date.now(), playCount: game.playCount + 1 });
  });

  ipcMain.handle('settings:save', (_e, patch) => {
    const s = settings.save(patch);
    if ('autostart' in patch) setAutostart(s.autostart);
    if ('combo' in patch || 'comboHoldMs' in patch || 'comboQuitGameMs' in patch) configurePad();
    return s;
  });

  ipcMain.handle('emulators:install', async (_e, ids) => {
    const errors = {};
    for (const id of ids) {
      try {
        await emulators.install(id, (progress, message) => {
          win.webContents.send('emulators:progress', { id, progress, message });
        });
      } catch (err) {
        errors[id] = err.message;
        win.webContents.send('emulators:progress', { id, progress: 0, message: `Error: ${err.message}`, error: true });
      }
    }
    return { errors, status: emulators.status() };
  });

  ipcMain.handle('emulators:pickExe', async (_e, id) => {
    const { name, exe } = emulators.EMULATORS[id];
    const r = await dialog.showOpenDialog(win, { title: `Elige ${exe} (${name})`, properties: ['openFile'], filters: [{ name, extensions: ['exe'] }] });
    if (r.canceled) return emulators.status();
    emulators.setCustomPath(id, r.filePaths[0]);
    return emulators.status();
  });
  ipcMain.handle('emulators:clearExe', (_e, id) => {
    emulators.setCustomPath(id, null);
    return emulators.status();
  });

  ipcMain.handle('pc:list', () => pcgames.loadManual());
  ipcMain.handle('pc:add', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Elige el juego (.exe o acceso directo)',
      properties: ['openFile'],
      filters: [{ name: 'Juegos', extensions: ['exe', 'lnk', 'url'] }],
    });
    if (r.canceled) return null;
    const entry = pcgames.addManual(r.filePaths[0]);
    library.scan();
    return entry;
  });
  ipcMain.handle('pc:rename', (_e, id, title) => {
    pcgames.renameManual(id, title);
    library.scan();
  });
  ipcMain.handle('pc:remove', (_e, id) => {
    pcgames.removeManual(id);
    library.scan();
  });

  ipcMain.handle('dialog:folder', async (_e, current) => {
    const r = await dialog.showOpenDialog(win, { defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('shell:open', (_e, which) => {
    const target = { roms: settings.load().romsDir, bios: emulators.biosDir(), emulators: emulators.emuRoot() }[which];
    if (target) return shell.openPath(target);
  });
  ipcMain.handle('app:hide', () => win.hide());
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
}

function init() {
  app.setAppUserModelId('com.gamehub.launcher');
  emulators.autoDetect();
  library.scan();
  registerIpc();
  createWindow();
  createTray();
  startGamepad();
  // En desarrollo solo se registra el inicio con Windows si se cambia en Ajustes
  if (app.isPackaged) setAutostart(settings.load().autostart);

  launcher.on('start', () => {
    win.hide();
    updatePollRate();
  });
  launcher.on('exit', (game, err) => {
    show(win);
    updatePollRate();
    win.webContents.send('game:exit', { game, error: err && err.message });
  });
}

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { quitting = true; });
