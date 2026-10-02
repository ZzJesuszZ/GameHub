// Juegos de PC: Steam y Epic Games (detectados) y los añadidos a mano.
// Cada juego usa como clave `path` un id estable: "steam:<appid>", "epic:<AppName>", "manual:<id>".

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { shell } = require('electron');
const settings = require('./settings');

// Herramientas de Steam que no son juegos
const STEAM_TOOLS = /redistributable|steamworks|proton|steam linux runtime|dedicated server|\bsdk\b|soundtrack/i;
const STEAM_TOOL_IDS = new Set(['228980']);

let steamRootCache;
function steamRoot() {
  if (steamRootCache !== undefined) return steamRootCache;
  steamRootCache = null;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) steamRootCache = path.normalize(m[1].trim());
  } catch { /* Steam no instalado */ }
  if (!steamRootCache && fs.existsSync('C:\\Program Files (x86)\\Steam')) steamRootCache = 'C:\\Program Files (x86)\\Steam';
  return steamRootCache;
}

const vdfValue = (text, key) => (text.match(new RegExp(`"${key}"\\s+"([^"]*)"`, 'i')) || [])[1];

function steamGames() {
  const root = steamRoot();
  if (!root) return [];
  let libs = [root];
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    libs = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => path.normalize(m[1].replace(/\\\\/g, '\\')));
  } catch { /* se usa solo la biblioteca principal */ }
  const games = [];
  for (const lib of [...new Set(libs)]) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch { continue; }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(apps, f), 'utf8');
        const appid = vdfValue(acf, 'appid');
        const name = vdfValue(acf, 'name');
        if (!appid || !name || STEAM_TOOL_IDS.has(appid) || STEAM_TOOLS.test(name)) continue;
        games.push({
          key: `steam:${appid}`, source: 'steam', appid, title: name,
          installDir: path.join(apps, 'common', vdfValue(acf, 'installdir') || ''),
        });
      } catch { /* manifiesto ilegible */ }
    }
  }
  return games;
}

function epicGames() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'));
  } catch { return []; }
  const games = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (m.bIsIncompleteInstall || !m.InstallLocation || !fs.existsSync(m.InstallLocation)) continue;
      if ((m.AppCategories || []).includes('addons')) continue;
      games.push({
        key: `epic:${m.AppName}`, source: 'epic', title: m.DisplayName.replace(/[®™©]/g, '').trim(),
        installDir: m.InstallLocation,
        epic: { namespace: m.CatalogNamespace, itemId: m.CatalogItemId, appName: m.AppName },
      });
    } catch { /* manifiesto ilegible */ }
  }
  return games;
}

// ---------- Juegos añadidos a mano (pcgames.json) ----------

const manualFile = () => path.join(settings.dataDir(), 'pcgames.json');

function loadManual() {
  try {
    return JSON.parse(fs.readFileSync(manualFile(), 'utf8'));
  } catch {
    return [];
  }
}

function saveManual(list) {
  fs.writeFileSync(manualFile(), JSON.stringify(list, null, 2));
}

// Nombre propuesto: la carpeta del juego suele ser más legible que el .exe
function suggestTitle(target) {
  const base = path.basename(target, path.extname(target));
  const folder = path.basename(path.dirname(target));
  const generic = /^(bin|bin64|x64|x86|win64|win32|binaries|game|release|launcher)$/i;
  const name = ['.lnk', '.url'].includes(path.extname(target).toLowerCase()) || generic.test(folder) || !folder ? base : folder;
  return name.replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Carpeta a vigilar para saber si el juego sigue abierto
function watchDirFor(target) {
  const ext = path.extname(target).toLowerCase();
  if (ext === '.exe') return path.dirname(target);
  if (ext === '.lnk') {
    try {
      const link = shell.readShortcutLink(target);
      if (link.target && link.target.toLowerCase().endsWith('.exe')) return path.dirname(link.target);
    } catch { /* acceso directo roto */ }
  }
  return null; // .url (steam://, etc.): no se puede vigilar
}

function addManual(target) {
  const list = loadManual();
  const entry = { id: Date.now().toString(36), title: suggestTitle(target), target };
  list.push(entry);
  saveManual(list);
  return entry;
}

function renameManual(id, title) {
  const list = loadManual();
  const e = list.find((x) => x.id === id);
  if (e && title.trim()) e.title = title.trim();
  saveManual(list);
}

function removeManual(id) {
  saveManual(loadManual().filter((x) => x.id !== id));
}

function manualGames() {
  return loadManual()
    .filter((e) => fs.existsSync(e.target))
    .map((e) => ({ key: `manual:${e.id}`, source: 'manual', manualId: e.id, title: e.title, target: e.target, installDir: watchDirFor(e.target) }));
}

function scan() {
  const all = [...steamGames(), ...epicGames(), ...manualGames()];
  // Si un juego está en Steam y Epic, se muestran ambos (pueden ser instalaciones distintas)
  return all;
}

// ---------- Lanzamiento ----------

function launch(game) {
  if (game.source === 'steam') return shell.openExternal(`steam://rungameid/${game.appid}`);
  if (game.source === 'epic') {
    const { namespace, itemId, appName } = game.epic;
    return shell.openExternal(`com.epicgames.launcher://apps/${namespace}%3A${itemId}%3A${appName}?action=launch&silent=true`);
  }
  if (path.extname(game.target).toLowerCase() === '.exe') {
    // Muchos juegos necesitan arrancar desde su propia carpeta
    spawn(game.target, [], { cwd: path.dirname(game.target), detached: true, stdio: 'ignore' }).unref();
    return Promise.resolve();
  }
  return shell.openPath(game.target).then((err) => {
    if (err) throw new Error(err);
  });
}

module.exports = { scan, launch, steamRoot, addManual, renameManual, removeManual, loadManual };
