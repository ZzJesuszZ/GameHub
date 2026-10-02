// Actualizaciones desde GitHub Releases (electron-updater). Nunca descarga ni
// instala nada sin que el usuario lo acepte. Gracias al .blockmap de cada versión,
// la descarga es diferencial: solo baja las partes del instalador que cambian.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let state = { status: 'idle', current: app.getVersion() };
let send = () => {};

// En desarrollo solo funciona si se pide expresamente (para probar):
//   GAMEHUB_UPDATE_TEST=1 GAMEHUB_FAKE_VERSION=1.0.0 npm start
const enabled = app.isPackaged || !!process.env.GAMEHUB_UPDATE_TEST;

function setState(patch) {
  state = { ...state, ...patch };
  send(state);
}

// Las notas de GitHub llegan en HTML; se pasan a texto plano
function notesText(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note).join('\n') : notes || '';
  return raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function init(sendFn) {
  send = sendFn;
  if (!enabled) {
    setState({ status: 'disabled' });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  if (!app.isPackaged) {
    const cfg = path.join(app.getPath('temp'), 'gamehub-dev-app-update.yml');
    fs.writeFileSync(cfg, 'provider: github\nowner: ZzJesuszZ\nrepo: GameHub\n');
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = cfg;
  }
  if (process.env.GAMEHUB_FAKE_VERSION) {
    // Misma clase SemVer que usa electron-updater (tiene su propia copia de semver)
    const SemVer = autoUpdater.currentVersion.constructor;
    autoUpdater.currentVersion = new SemVer(process.env.GAMEHUB_FAKE_VERSION);
    state.current = process.env.GAMEHUB_FAKE_VERSION;
  }

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => setState({ status: 'available', version: info.version, notes: notesText(info.releaseNotes) }));
  autoUpdater.on('update-not-available', () => setState({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', percent: Math.round(p.percent), transferred: p.transferred, total: p.total }));
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => setState({ status: 'error', error: (err && err.message ? err.message : String(err)).split('\n')[0] }));
}

async function check() {
  if (!enabled) return state;
  if (['downloading', 'downloaded'].includes(state.status)) return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch { /* el evento 'error' ya actualiza el estado */ }
  return state;
}

async function download() {
  if (state.status !== 'available') return state;
  setState({ status: 'downloading', percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch { /* el evento 'error' ya actualiza el estado */ }
  return state;
}

// Instala en silencio y vuelve a abrir GameHub
function install() {
  if (state.status === 'downloaded') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, download, install, getState: () => state };
