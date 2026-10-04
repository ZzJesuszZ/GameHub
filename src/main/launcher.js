// Lanza el emulador de un juego y lo vigila. Al cerrar se intenta primero un
// cierre normal (para que el emulador guarde la partida/SRAM) y luego forzado.

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const path = require('path');
const { byId } = require('./consoles');
const emulators = require('./emulators');
const pcgames = require('./pcgames');
const procwatch = require('./procwatch');

// Juegos de PC: el launcher (Steam/Epic) devuelve el control enseguida, así que
// se vigila si hay procesos dentro de la carpeta del juego.
const PC_POLL_MS = 2000;
const PC_START_TIMEOUT = 90_000;
const PC_GONE_MS = 5000;

class Launcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.game = null;
  }

  get running() {
    return !!this.proc || !!this.watch;
  }

  get isPc() {
    return !!this.watch;
  }

  async launch(game, padNames = []) {
    if (this.running) throw new Error('Ya hay un juego en marcha');
    if (game.console === 'pc') return this.launchPc(game);
    const c = byId[game.console];
    if (!emulators.isReady(c)) throw new Error(`Falta instalar ${emulators.EMULATORS[c.emulator].name}`);
    emulators.prepareLaunch(c, padNames);
    const [exe, args] = emulators.launchCommand(c, game.path);
    const proc = spawn(exe, args, { cwd: path.dirname(exe), detached: false, stdio: 'ignore' });
    this.proc = proc;
    this.game = game;
    proc.on('error', (err) => this.finish(err));
    proc.on('exit', () => this.finish());
    this.emit('start', game);
  }

  // Abre un emulador solo (sin juego) para tocar sus ajustes: mando, vídeo, BIOS…
  launchEmulator(emulatorId) {
    if (this.running) throw new Error('Ya hay un juego en marcha');
    const [exe, args] = emulators.launchStandalone(emulatorId);
    const proc = spawn(exe, args, { cwd: path.dirname(exe), detached: false, stdio: 'ignore' });
    this.proc = proc;
    this.game = { console: null, path: null, title: `${emulators.EMULATORS[emulatorId].name} (ajustes)` };
    proc.on('error', (err) => this.finish(err));
    proc.on('exit', () => this.finish());
    this.emit('start', this.game);
  }

  async launchPc(game) {
    await pcgames.launch(game);
    this.game = game;
    if (!game.installDir) {
      // Accesos .url: no hay carpeta que vigilar; GameHub vuelve con el combo del mando
      this.emit('start', game);
      this.game = null;
      return;
    }
    const started = Date.now();
    let seen = 0;
    this.watch = setInterval(() => {
      const now = Date.now();
      let alive = false;
      try {
        alive = procwatch.anyUnder(game.installDir);
      } catch { /* si falla la consulta se espera al siguiente intento */ }
      if (alive) seen = now;
      else if (seen ? now - seen > PC_GONE_MS : now - started > PC_START_TIMEOUT) this.finish();
    }, PC_POLL_MS);
    this.emit('start', game);
  }

  finish(err) {
    if (!this.proc && !this.watch) return;
    const game = this.game;
    clearTimeout(this.killTimer);
    clearInterval(this.watch);
    this.watch = null;
    this.proc = null;
    this.game = null;
    this.emit('exit', game, err);
  }

  // Los juegos de PC no se cierran desde GameHub (podría perderse la partida)
  stop() {
    if (!this.proc) return;
    const pid = this.proc.pid;
    execFile('taskkill', ['/PID', String(pid), '/T'], () => {});
    this.killTimer = setTimeout(() => {
      if (this.proc && this.proc.pid === pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
    }, 5000);
  }
}

module.exports = { Launcher };
