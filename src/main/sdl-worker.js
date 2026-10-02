// Hilo que lee todos los mandos con SDL3 (Xbox, PlayStation, Switch, genéricos)
// y envía al hilo principal el estado combinado en formato "Xbox":
//   { pressed: ['a', 'start', ...], any: bool, names: [...] }
// Corre en un worker para que SDL procese los mensajes de Windows de su propio
// hilo sin tocar el bucle de eventos de Electron.

const { parentPort, workerData } = require('worker_threads');
const koffi = require('koffi');

const sdl = koffi.load(workerData.dllPath);
const SDL_SetHint = sdl.func('bool SDL_SetHint(const char *name, const char *value)');
const SDL_Init = sdl.func('bool SDL_Init(uint32 flags)');
const SDL_GetError = sdl.func('const char *SDL_GetError()');
const SDL_PumpEvents = sdl.func('void SDL_PumpEvents()');
const SDL_UpdateGamepads = sdl.func('void SDL_UpdateGamepads()');
const SDL_GetGamepads = sdl.func('void *SDL_GetGamepads(_Out_ int *count)');
const SDL_free = sdl.func('void SDL_free(void *mem)');
const SDL_OpenGamepad = sdl.func('void *SDL_OpenGamepad(uint32 id)');
const SDL_CloseGamepad = sdl.func('void SDL_CloseGamepad(void *gamepad)');
const SDL_GamepadConnected = sdl.func('bool SDL_GamepadConnected(void *gamepad)');
const SDL_GetGamepadName = sdl.func('const char *SDL_GetGamepadName(void *gamepad)');
const SDL_GetGamepadButton = sdl.func('bool SDL_GetGamepadButton(void *gamepad, int button)');
const SDL_GetGamepadAxis = sdl.func('int16 SDL_GetGamepadAxis(void *gamepad, int axis)');

const SDL_INIT_GAMEPAD = 0x00002000;

// Botones SDL (posición física) -> nombres estilo Xbox que usa GameHub.
// En un mando de PlayStation: Cruz=a, Círculo=b, Cuadrado=x, Triángulo=y,
// Share/Create=back, Options=start, botón PS=guide.
const BUTTONS = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'back', 5: 'guide', 6: 'start',
  7: 'ls', 8: 'rs', 9: 'lb', 10: 'rb', 11: 'up', 12: 'down', 13: 'left', 14: 'right',
};
const AXIS = { LX: 0, LY: 1, RX: 2, RY: 3, LT: 4, RT: 5 };
const DEADZONE = 16000;
const TRIGGER = 8000;

SDL_SetHint('SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS', '1');
SDL_SetHint('SDL_JOYSTICK_HIDAPI_PS4_RUMBLE', '0');
SDL_SetHint('SDL_JOYSTICK_HIDAPI_PS5_RUMBLE', '0');
if (!SDL_Init(SDL_INIT_GAMEPAD)) {
  parentPort.postMessage({ error: `SDL_Init: ${SDL_GetError()}` });
  process.exit(1);
}

const open = new Map(); // id -> handle

function refreshDevices() {
  const out = [0];
  const ptr = SDL_GetGamepads(out);
  const ids = ptr && out[0] ? koffi.decode(ptr, 'uint32', out[0]) : [];
  if (ptr) SDL_free(ptr);
  for (const id of ids) {
    if (!open.has(id)) {
      const handle = SDL_OpenGamepad(id);
      if (handle) open.set(id, handle);
    }
  }
  for (const [id, handle] of open) {
    if (!ids.includes(id) || !SDL_GamepadConnected(handle)) {
      SDL_CloseGamepad(handle);
      open.delete(id);
    }
  }
}

let rate = workerData.rate || 16;
let lastScan = 0;
let lastKey = '';

function poll() {
  SDL_PumpEvents();
  SDL_UpdateGamepads();
  const now = Date.now();
  if (now - lastScan > 1000) {
    lastScan = now;
    refreshDevices();
  }
  const pressed = new Set();
  for (const handle of open.values()) {
    for (const [btn, name] of Object.entries(BUTTONS)) {
      if (SDL_GetGamepadButton(handle, Number(btn))) pressed.add(name);
    }
    const lx = SDL_GetGamepadAxis(handle, AXIS.LX);
    const ly = SDL_GetGamepadAxis(handle, AXIS.LY); // en SDL, positivo = abajo
    if (lx < -DEADZONE) pressed.add('left');
    if (lx > DEADZONE) pressed.add('right');
    if (ly < -DEADZONE) pressed.add('up');
    if (ly > DEADZONE) pressed.add('down');
    if (SDL_GetGamepadAxis(handle, AXIS.LT) > TRIGGER) pressed.add('lt');
    if (SDL_GetGamepadAxis(handle, AXIS.RT) > TRIGGER) pressed.add('rt');
  }
  const state = { pressed: [...pressed].sort(), any: open.size > 0 };
  const key = JSON.stringify(state);
  // Solo se envía cuando cambia algo
  if (key !== lastKey) {
    lastKey = key;
    state.names = [...open.values()].map((h) => SDL_GetGamepadName(h));
    parentPort.postMessage(state);
  }
}

let timer = setInterval(poll, rate);
parentPort.on('message', (msg) => {
  if (msg.rate && msg.rate !== rate) {
    rate = msg.rate;
    clearInterval(timer);
    timer = setInterval(poll, rate);
  }
});
