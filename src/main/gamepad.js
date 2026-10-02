// Lectura de mandos. Usa SDL3 en un hilo aparte (sdl-worker.js), que entiende
// mandos de Xbox, PlayStation, Switch y genéricos. Si SDL fallase, usa XInput
// (solo mandos tipo Xbox). Los botones siempre se nombran con la disposición Xbox.
// Emite:
//   'button' (name)              pulsación (con auto-repetición en direcciones)
//   'combo'  (heldMs)            el combo configurado lleva heldMs pulsado (umbrales en setCombo)
//   'connection' (bool, names)   cambia el mando conectado

const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const path = require('path');
const koffi = require('koffi');

const BUTTONS = {
  up: 0x0001, down: 0x0002, left: 0x0004, right: 0x0008,
  start: 0x0010, back: 0x0020, ls: 0x0040, rs: 0x0080,
  lb: 0x0100, rb: 0x0200, a: 0x1000, b: 0x2000, x: 0x4000, y: 0x8000,
};
const DIRECTIONS = ['up', 'down', 'left', 'right'];
// start/back se emiten al soltar, para no disparar su acción si formaban parte del combo
const ON_RELEASE = ['start', 'back'];
const DEADZONE = 16000;
const TRIGGER_THRESHOLD = 100;
const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;

let XInputGetState = null;
function loadXInput() {
  if (XInputGetState) return XInputGetState;
  const GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
    wButtons: 'uint16', bLeftTrigger: 'uint8', bRightTrigger: 'uint8',
    sThumbLX: 'int16', sThumbLY: 'int16', sThumbRX: 'int16', sThumbRY: 'int16',
  });
  const STATE = koffi.struct('XINPUT_STATE', { dwPacketNumber: 'uint32', Gamepad: GAMEPAD });
  for (const dll of ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']) {
    try {
      const lib = koffi.load(dll);
      XInputGetState = lib.func('uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)');
      return XInputGetState;
    } catch { /* probar la siguiente */ }
  }
  throw new Error('No se encontró XInput en el sistema');
}

class Gamepad extends EventEmitter {
  constructor() {
    super();
    this.prev = new Set();
    this.heldSince = {};
    this.lastRepeat = {};
    this.combo = ['back', 'start'];
    this.comboThresholds = [1000];
    this.comboStart = 0;
    this.comboFired = new Set();
    this.comboUsed = false;
    this.connected = false;
    this.timer = null;
    this.rate = 16;
    // Comprobar mandos desconectados es caro en XInput; se hace con menos frecuencia
    this.slots = [true, true, true, true];
    this.lastSlotScan = 0;
    this.backend = null;
    this.worker = null;
    this.sdlState = { pressed: new Set(), any: false };
    this.names = [];
  }

  start(rate = 16) {
    this.rate = rate;
    if (!this.startSdl()) this.useXInput();
    this.setRate(rate);
  }

  startSdl() {
    try {
      // En el paquete final la DLL queda fuera del asar
      const dllPath = path.join(__dirname, 'vendor', 'SDL3.dll').replace('app.asar', 'app.asar.unpacked');
      this.worker = new Worker(path.join(__dirname, 'sdl-worker.js'), { workerData: { dllPath, rate: this.rate } });
    } catch (err) {
      console.error('SDL no disponible:', err.message);
      return false;
    }
    this.backend = 'sdl';
    this.worker.on('message', (m) => {
      if (m.error) return this.useXInput(m.error);
      this.sdlState = { pressed: new Set(m.pressed), any: m.any };
      if (m.names) this.names = m.names;
    });
    this.worker.on('error', (err) => this.useXInput(err.message));
    this.worker.on('exit', (code) => code && this.useXInput(`SDL terminó con código ${code}`));
    return true;
  }

  useXInput(reason) {
    if (this.backend === 'xinput') return;
    if (reason) console.error('SDL falló, se usa XInput:', reason);
    const worker = this.worker;
    this.worker = null;
    this.backend = 'xinput';
    worker?.terminate();
    loadXInput();
  }

  setRate(rate) {
    this.rate = rate;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), rate);
    this.worker?.postMessage({ rate });
  }

  setCombo(buttons, thresholds) {
    this.combo = buttons;
    this.comboThresholds = [...thresholds].sort((a, b) => a - b);
  }

  readButtons() {
    if (this.backend === 'sdl') return this.sdlState;
    return this.readXInput();
  }

  readXInput() {
    const now = Date.now();
    const rescan = now - this.lastSlotScan > 2000;
    if (rescan) this.lastSlotScan = now;
    let mask = 0;
    let lx = 0, ly = 0, lt = 0, rt = 0;
    let any = false;
    for (let i = 0; i < 4; i++) {
      if (!this.slots[i] && !rescan) continue;
      const state = {};
      const ok = XInputGetState(i, state) === 0;
      this.slots[i] = ok;
      if (!ok) continue;
      any = true;
      const g = state.Gamepad;
      mask |= g.wButtons;
      if (Math.abs(g.sThumbLX) > Math.abs(lx)) lx = g.sThumbLX;
      if (Math.abs(g.sThumbLY) > Math.abs(ly)) ly = g.sThumbLY;
      lt = Math.max(lt, g.bLeftTrigger);
      rt = Math.max(rt, g.bRightTrigger);
    }
    const pressed = new Set();
    for (const [name, bit] of Object.entries(BUTTONS)) if (mask & bit) pressed.add(name);
    // El stick izquierdo actúa como cruceta
    if (lx < -DEADZONE) pressed.add('left');
    if (lx > DEADZONE) pressed.add('right');
    if (ly > DEADZONE) pressed.add('up');
    if (ly < -DEADZONE) pressed.add('down');
    if (lt > TRIGGER_THRESHOLD) pressed.add('lt');
    if (rt > TRIGGER_THRESHOLD) pressed.add('rt');
    return { pressed, any };
  }

  poll() {
    let result;
    try {
      result = this.readButtons();
    } catch {
      return;
    }
    const { pressed, any } = result;
    const namesKey = this.names.join('|');
    if (any !== this.connected || namesKey !== this.lastNames) {
      this.connected = any;
      this.lastNames = namesKey;
      this.emit('connection', any, this.names);
    }
    const now = Date.now();

    // Combo
    const comboHeld = this.combo.length > 0 && this.combo.every((b) => pressed.has(b));
    if (comboHeld) {
      if (!this.comboStart) {
        this.comboStart = now;
        this.comboUsed = true;
      }
      const held = now - this.comboStart;
      for (const t of this.comboThresholds) {
        if (held >= t && !this.comboFired.has(t)) {
          this.comboFired.add(t);
          this.emit('combo', t);
        }
      }
    } else {
      this.comboStart = 0;
      this.comboFired.clear();
    }

    for (const name of pressed) {
      if (!this.prev.has(name)) {
        this.heldSince[name] = now;
        this.lastRepeat[name] = now;
        if (!ON_RELEASE.includes(name)) this.emit('button', name);
      } else if (DIRECTIONS.includes(name)) {
        if (now - this.heldSince[name] > REPEAT_DELAY && now - this.lastRepeat[name] > REPEAT_RATE) {
          this.lastRepeat[name] = now;
          this.emit('button', name);
        }
      }
    }
    for (const name of this.prev) {
      if (!pressed.has(name) && ON_RELEASE.includes(name)) {
        if (!this.comboUsed) this.emit('button', name);
      }
    }
    if (!this.combo.some((b) => pressed.has(b))) this.comboUsed = false;
    this.prev = pressed;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.worker?.terminate();
  }
}

module.exports = { Gamepad, BUTTON_NAMES: [...Object.keys(BUTTONS), 'guide', 'lt', 'rt'] };
