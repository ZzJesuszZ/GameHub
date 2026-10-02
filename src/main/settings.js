const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  setupDone: false,
  romsDir: path.join(app.getPath('documents'), 'Juegos', 'roms'),
  autostart: true,
  // Botones del combo (nombres de xinput.js) y tiempos en ms
  combo: ['back', 'start'],
  comboHoldMs: 1000,
  comboQuitGameMs: 2000,
  steamGridDbKey: '',
  // Emuladores propios del usuario: { pcsx2: 'C:\...\pcsx2-qt.exe' }
  emulatorPaths: {},
  sounds: true,
  // Estilo de la interfaz: consola | synthwave | mezcla | clasico
  theme: 'consola',
};

let cache = null;

function dataDir() {
  return app.getPath('userData');
}

function file() {
  return path.join(dataDir(), 'settings.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { load, save, dataDir };
