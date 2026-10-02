// Descarga, instalación (modo portable) y preconfiguración de los emuladores.
// Todo va a %APPDATA%\GameHub\emulators\<id>. Las BIOS van en %APPDATA%\GameHub\bios.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const extractZip = require('extract-zip');
const { CONSOLES } = require('./consoles');
const settings = require('./settings');

const UA = { 'User-Agent': 'GameHub/1.0 (Electron)' };

const EMULATORS = {
  retroarch: { name: 'RetroArch', exe: 'retroarch.exe', desc: 'NES, SNES, N64, Game Boy, GBA, DS, PS1' },
  dolphin:   { name: 'Dolphin',   exe: 'Dolphin.exe',   desc: 'GameCube y Wii' },
  pcsx2:     { name: 'PCSX2',     exe: 'pcsx2-qt.exe',  desc: 'PlayStation 2' },
  ppsspp:    { name: 'PPSSPP',    exe: 'PPSSPPWindows64.exe', desc: 'PSP' },
};

const RETROARCH_CORES = [...new Set(CONSOLES.filter((c) => c.core).map((c) => c.core))];

const emuRoot = () => path.join(settings.dataDir(), 'emulators');
const emuDir = (id) => path.join(emuRoot(), id);
const internalExe = (id) => path.join(emuDir(id), EMULATORS[id].exe);
const biosDir = () => path.join(settings.dataDir(), 'bios');

// Emulador ya instalado por el usuario (fuera de GameHub)
function externalExe(id) {
  const custom = (settings.load().emulatorPaths || {})[id];
  return custom && fs.existsSync(custom) ? custom : null;
}
const exePath = (id) => externalExe(id) || internalExe(id);
const corePath = (core) => path.join(path.dirname(exePath('retroarch')), 'cores', `${core}_libretro.dll`);

// Carpetas donde se suelen instalar los emuladores
function candidateDirs() {
  const home = os.homedir();
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs'), 'C:\\'];
  const dirs = [];
  for (const r of roots.filter(Boolean)) {
    for (const name of ['PCSX2', 'Dolphin', 'Dolphin Emulator', 'Dolphin-x64', 'PPSSPP', 'RetroArch', 'RetroArch-Win64']) dirs.push(path.join(r, name));
  }
  // Carpetas personales: cualquier subcarpeta de primer nivel (p. ej. Documentos\PSX2)
  for (const base of ['Documents', 'Desktop', 'Downloads', 'Games', 'Juegos'].map((d) => path.join(home, d))) {
    try {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory()) dirs.push(path.join(base, e.name));
    } catch { /* no existe */ }
  }
  return dirs;
}

function detect() {
  const found = {};
  const dirs = candidateDirs();
  for (const [id, e] of Object.entries(EMULATORS)) {
    for (const d of dirs) {
      const exe = path.join(d, e.exe);
      if (!exe.startsWith(emuRoot()) && fs.existsSync(exe)) { found[id] = exe; break; }
    }
  }
  return found;
}

// Al arrancar: usar los emuladores del usuario que GameHub no tenga instalados
function autoDetect() {
  const current = settings.load().emulatorPaths || {};
  const paths = { ...current };
  for (const [id, exe] of Object.entries(detect())) {
    if (!paths[id] && !fs.existsSync(internalExe(id))) paths[id] = exe;
  }
  if (JSON.stringify(paths) !== JSON.stringify(current)) settings.save({ emulatorPaths: paths });
}

function setCustomPath(id, exe) {
  if (exe && path.basename(exe).toLowerCase() !== EMULATORS[id].exe.toLowerCase()) {
    throw new Error(`Para ${EMULATORS[id].name} hay que elegir ${EMULATORS[id].exe}`);
  }
  const paths = { ...(settings.load().emulatorPaths || {}) };
  if (exe) paths[id] = exe; else delete paths[id];
  settings.save({ emulatorPaths: paths });
}

function sevenZipPath() {
  // En el paquete final 7zip-bin queda fuera del asar
  return require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
}

function status() {
  return Object.entries(EMULATORS).map(([id, e]) => {
    const installed = fs.existsSync(exePath(id));
    const missingCores = id === 'retroarch' ? RETROARCH_CORES.filter((c) => !fs.existsSync(corePath(c))) : [];
    const external = externalExe(id);
    return {
      id, name: e.name, desc: e.desc, installed: installed && missingCores.length === 0,
      external: !!external, path: external,
      consoles: CONSOLES.filter((c) => c.emulator === id).map((c) => c.id),
    };
  });
}

function isReady(consoleDef) {
  if (consoleDef.pc) return true;
  if (!fs.existsSync(exePath(consoleDef.emulator))) return false;
  return !consoleDef.core || fs.existsSync(corePath(consoleDef.core));
}

// ---------- Resolución de URLs de la última versión ----------

async function getText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

const RESOLVERS = {
  async retroarch() {
    const html = await getText('https://buildbot.libretro.com/stable/');
    const versions = [...html.matchAll(/href="\/stable\/(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]);
    versions.sort((a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
    const v = versions.pop();
    return `https://buildbot.libretro.com/stable/${v}/windows/x86_64/RetroArch.7z`;
  },
  async pcsx2() {
    const res = await fetch('https://api.github.com/repos/PCSX2/pcsx2/releases/latest', { headers: UA });
    const json = await res.json();
    const asset = (json.assets || []).find((a) => /windows-x64-Qt\.7z$/i.test(a.name));
    if (!asset) throw new Error('No se encontró la descarga de PCSX2 para Windows');
    return asset.browser_download_url;
  },
  async dolphin() {
    try {
      const json = JSON.parse(await getText('https://dolphin-emu.org/update/latest/beta'));
      const art = json.artifacts.find((a) => a.system === 'Windows x64');
      if (art) return art.url;
    } catch { /* la web a veces muestra un reto anti-bots; usar versión conocida */ }
    return 'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-x64.7z';
  },
  async ppsspp() {
    const html = await getText('https://www.ppsspp.org/download/');
    const m = html.match(/https:\/\/www\.ppsspp\.org\/files\/[\w.]+\/ppsspp_win\.zip/);
    if (!m) throw new Error('No se encontró la descarga de PPSSPP');
    return m[0];
  },
};

// ---------- Descarga y extracción ----------

async function download(url, dest, onProgress) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    if (total) onProgress(done / total);
  });
  await pipeline(body, fs.createWriteStream(dest));
}

function extract7z(file, outDir) {
  return new Promise((resolve, reject) => {
    const p = spawn(sevenZipPath(), ['x', file, `-o${outDir}`, '-y'], { windowsHide: true });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`7-Zip terminó con código ${code}`))));
  });
}

async function extract(file, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (file.endsWith('.zip')) await extractZip(file, { dir: outDir });
  else await extract7z(file, outDir);
}

function findFile(dir, name, depth = 3) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory() && depth > 0) {
      const found = findFile(full, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

// Extrae en temporal y mueve la carpeta que contiene el exe a emulators/<id>
async function installArchive(id, url, onProgress) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gamehub-${id}-`));
  try {
    const archive = path.join(tmp, path.basename(new URL(url).pathname));
    await download(url, archive, (p) => onProgress(p * 0.85, 'Descargando'));
    onProgress(0.88, 'Extrayendo');
    const out = path.join(tmp, 'out');
    await extract(archive, out);
    const exe = findFile(out, EMULATORS[id].exe);
    if (!exe) throw new Error(`No se encontró ${EMULATORS[id].exe} en la descarga`);
    const target = emuDir(id);
    fs.mkdirSync(target, { recursive: true });
    // Copiar encima conserva partidas/configuración si es una actualización
    fs.cpSync(path.dirname(exe), target, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function installCores(onProgress) {
  const dir = path.dirname(corePath('x'));
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, core] of RETROARCH_CORES.entries()) {
    onProgress(i / RETROARCH_CORES.length, `Core ${core}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-core-'));
    try {
      const zip = path.join(tmp, `${core}.zip`);
      await download(`https://buildbot.libretro.com/nightly/windows/x86_64/latest/${core}_libretro.dll.zip`, zip, () => {});
      await extractZip(zip, { dir });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// ---------- Preconfiguración (solo si el usuario no tiene ya su config) ----------

function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.trim() + '\n');
}

// Cambia claves `key = "value"` de un .cfg de RetroArch manteniendo el resto
function patchRetroArchCfg(file, values) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const [k, v] of Object.entries(values)) {
    const line = `${k} = "${v}"`;
    const re = new RegExp(`^${k}\\s*=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  fs.writeFileSync(file, text);
}

// Mandos de Dolphin según el mando conectado. Solo se reescriben mientras el
// fichero siga siendo el generado por GameHub (si lo cambias en Dolphin, se respeta).
const DOLPHIN_MARK = '# GameHub';
const DOLPHIN_NAMES = {
  xinput: { a: 'Button A', b: 'Button B', x: 'Button X', y: 'Button Y', up: 'Left Y+', down: 'Left Y-', rup: 'Right Y+', rdown: 'Right Y-' },
  sdl:    { a: 'Button S', b: 'Button E', x: 'Button W', y: 'Button N', up: 'Left Y-', down: 'Left Y+', rup: 'Right Y-', rdown: 'Right Y+' },
};

function dolphinDevice(padName) {
  if (!padName || /xbox|xinput/i.test(padName)) return { device: 'XInput/0/Gamepad', n: DOLPHIN_NAMES.xinput };
  return { device: `SDL/0/${padName}`, n: DOLPHIN_NAMES.sdl };
}

function writeDolphinPads(padName) {
  const cfg = path.join(emuDir('dolphin'), 'User', 'Config');
  const gcFile = path.join(cfg, 'GCPadNew.ini');
  const wiiFile = path.join(cfg, 'WiimoteNew.ini');
  const ours = (f) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8').startsWith(DOLPHIN_MARK);
  const { device, n } = dolphinDevice(padName);
  const q = (name) => `\`${name}\``;
  fs.mkdirSync(cfg, { recursive: true });
  if (ours(gcFile)) {
    fs.writeFileSync(gcFile, `${DOLPHIN_MARK}
[GCPad1]
Device = ${device}
Buttons/A = ${q(n.a)}
Buttons/B = ${q(n.b)}
Buttons/X = ${q(n.x)}
Buttons/Y = ${q(n.y)}
Buttons/Z = ${q('Shoulder R')}
Buttons/Start = Start
Main Stick/Up = ${q(n.up)}
Main Stick/Down = ${q(n.down)}
Main Stick/Left = ${q('Left X-')}
Main Stick/Right = ${q('Left X+')}
C-Stick/Up = ${q(n.rup)}
C-Stick/Down = ${q(n.rdown)}
C-Stick/Left = ${q('Right X-')}
C-Stick/Right = ${q('Right X+')}
Triggers/L = ${q('Trigger L')}
Triggers/R = ${q('Trigger R')}
Triggers/L-Analog = ${q('Trigger L')}
Triggers/R-Analog = ${q('Trigger R')}
D-Pad/Up = ${q('Pad N')}
D-Pad/Down = ${q('Pad S')}
D-Pad/Left = ${q('Pad W')}
D-Pad/Right = ${q('Pad E')}
`);
  }
  if (ours(wiiFile)) {
    fs.writeFileSync(wiiFile, `${DOLPHIN_MARK}
[Wiimote1]
Device = ${device}
Source = 1
Extension = Nunchuk
Buttons/A = ${q(n.a)}
Buttons/B = ${q('Trigger R')}
Buttons/1 = ${q(n.x)}
Buttons/2 = ${q(n.y)}
Buttons/- = Back
Buttons/+ = Start
Buttons/Home = ${q('Thumb R')}
D-Pad/Up = ${q('Pad N')}
D-Pad/Down = ${q('Pad S')}
D-Pad/Left = ${q('Pad W')}
D-Pad/Right = ${q('Pad E')}
IR/Up = ${q(n.rup)}
IR/Down = ${q(n.rdown)}
IR/Left = ${q('Right X-')}
IR/Right = ${q('Right X+')}
Shake/X = ${q(n.b)}
Shake/Y = ${q(n.b)}
Shake/Z = ${q(n.b)}
Nunchuk/Buttons/C = ${q('Shoulder L')}
Nunchuk/Buttons/Z = ${q('Trigger L')}
Nunchuk/Stick/Up = ${q(n.up)}
Nunchuk/Stick/Down = ${q(n.down)}
Nunchuk/Stick/Left = ${q('Left X-')}
Nunchuk/Stick/Right = ${q('Left X+')}
Nunchuk/Shake/X = ${q('Shoulder R')}
Nunchuk/Shake/Y = ${q('Shoulder R')}
Nunchuk/Shake/Z = ${q('Shoulder R')}
`);
  }
}

// Ajustes justo antes de lanzar (p. ej. el mando conectado ahora mismo)
function prepareLaunch(consoleDef, padNames = []) {
  if (consoleDef.emulator === 'dolphin' && !externalExe('dolphin')) writeDolphinPads(padNames[0]);
}

const CONFIGURE = {
  retroarch() {
    const dir = emuDir('retroarch');
    patchRetroArchCfg(path.join(dir, 'retroarch.cfg'), {
      system_directory: path.join(biosDir(), 'psx'),
      input_joypad_driver: 'xinput',
      input_autodetect_enable: 'true',
      pause_nonactive: 'false',
      video_fullscreen: 'true',
      // En pantalla completa, sin preguntar al salir
      quit_press_twice: 'false',
      menu_show_core_updater: 'false',
      // El menú de RetroArch sigue disponible con L3+R3
      input_menu_toggle_gamepad_combo: '2',
    });
  },
  dolphin() {
    const dir = emuDir('dolphin');
    writeIfMissing(path.join(dir, 'portable.txt'), '');
    const cfg = path.join(dir, 'User', 'Config');
    writeIfMissing(path.join(cfg, 'Dolphin.ini'), `
[Display]
Fullscreen = True
RenderToMain = True
[Interface]
ConfirmStop = False
[Analytics]
PermissionAsked = True
Enabled = False
[AutoUpdate]
UpdateTrack =
`);
    writeDolphinPads(null);
  },
  pcsx2() {
    const dir = emuDir('pcsx2');
    writeIfMissing(path.join(dir, 'portable.ini'), '');
    // SDL entiende mandos de Xbox, PlayStation y genéricos con los mismos nombres
    const pad = (b) => `SDL-0/${b}`;
    writeIfMissing(path.join(dir, 'inis', 'PCSX2.ini'), `
[UI]
SetupWizardIncomplete = false
StartFullscreen = true
ConfirmShutdown = false
HideMouseCursor = true
[Folders]
Bios = ${path.join(biosDir(), 'ps2')}
[InputSources]
SDL = true
SDLControllerEnhancedMode = true
XInput = false
[Pad1]
Type = DualShock2
Up = ${pad('DPadUp')}
Right = ${pad('DPadRight')}
Down = ${pad('DPadDown')}
Left = ${pad('DPadLeft')}
Triangle = ${pad('FaceNorth')}
Circle = ${pad('FaceEast')}
Cross = ${pad('FaceSouth')}
Square = ${pad('FaceWest')}
Select = ${pad('Back')}
Start = ${pad('Start')}
L1 = ${pad('LeftShoulder')}
R1 = ${pad('RightShoulder')}
L2 = ${pad('+LeftTrigger')}
R2 = ${pad('+RightTrigger')}
L3 = ${pad('LeftStick')}
R3 = ${pad('RightStick')}
LUp = ${pad('-LeftY')}
LRight = ${pad('+LeftX')}
LDown = ${pad('+LeftY')}
LLeft = ${pad('-LeftX')}
RUp = ${pad('-RightY')}
RRight = ${pad('+RightX')}
RDown = ${pad('+RightY')}
RLeft = ${pad('-RightX')}
`);
  },
  ppsspp() {
    // PPSSPP es portable si no existe installed.txt; reconoce mandos Xbox y PlayStation por defecto
    fs.mkdirSync(path.join(emuDir('ppsspp'), 'memstick'), { recursive: true });
  },
};

function ensureBiosFolders() {
  for (const sub of ['psx', 'ps2']) fs.mkdirSync(path.join(biosDir(), sub), { recursive: true });
}

async function install(id, onProgress) {
  ensureBiosFolders();
  const external = !!externalExe(id);
  // Solo se descarga si falta: "Reparar" no debe sobrescribir un emulador ya instalado
  if (!external && !fs.existsSync(internalExe(id))) {
    onProgress(0, 'Buscando la última versión');
    const url = await RESOLVERS[id]();
    await installArchive(id, url, onProgress);
  }
  if (id === 'retroarch') await installCores((p, msg) => onProgress(0.9 + p * 0.1, msg));
  // La configuración de un emulador propio del usuario no se toca
  if (!external) CONFIGURE[id]();
  onProgress(1, 'Instalado');
}

// Línea de comandos para lanzar un juego
function launchCommand(consoleDef, romPath) {
  const exe = exePath(consoleDef.emulator);
  switch (consoleDef.emulator) {
    case 'retroarch': return [exe, ['-f', '-L', corePath(consoleDef.core), romPath]];
    case 'dolphin':   return [exe, ['-b', '-e', romPath]];
    case 'pcsx2':     return [exe, ['-batch', '-nogui', '-fullscreen', '--', romPath]];
    case 'ppsspp':    return [exe, ['--fullscreen', romPath]];
    default: throw new Error(`Emulador desconocido: ${consoleDef.emulator}`);
  }
}

module.exports = { EMULATORS, status, install, isReady, launchCommand, prepareLaunch, biosDir, emuRoot, autoDetect, setCustomPath };
