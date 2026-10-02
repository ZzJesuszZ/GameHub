import { HomeView } from './views/home.js';
import { GamesView } from './views/games.js';
import { SettingsView } from './views/settings.js';
import { SetupView } from './views/setup.js';
import { sounds } from './sound.js';
import { cutout } from './cutout.js';
import { promptUpdate } from './update.js';

const api = window.gamehub;
const PS_GLYPHS = { A: '✕', B: '○', X: '□', Y: '△', Menu: 'Options', View: 'Share', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2' };
const $ = (s) => document.querySelector(s);

export const app = {
  state: null,
  view: null,
  stack: [],
  active: true,
  // 'xbox' o 'ps': cambia los símbolos de botones que se muestran
  padStyle: 'xbox',
  // Solo el ratón que se mueve de verdad cambia el foco (no el que queda debajo al desplazar)
  pointer: false,

  async refresh() {
    this.state = await api.getState();
    sounds.enabled = this.state.settings.sounds;
    this.applyTheme(this.state.settings.theme);
    return this.state;
  },

  applyTheme(theme = 'consola') {
    document.body.dataset.theme = theme;
  },

  console(id) {
    return this.state.consoles.find((c) => c.id === id);
  },

  // ---------- Navegación entre vistas ----------
  go(ViewClass, params = {}, { replace = false } = {}) {
    if (this.view) {
      this.view.unmount?.();
      if (!replace) this.stack.push({ ViewClass: this.view.constructor, params: this.view.params });
    }
    this.mount(ViewClass, params);
  },

  back() {
    const prev = this.stack.pop();
    if (!prev) return false;
    this.view.unmount?.();
    this.mount(prev.ViewClass, { ...prev.params, restoring: true });
    sounds.back();
    return true;
  },

  mount(ViewClass, params) {
    setConsoleArt(null);
    const root = $('#view');
    root.innerHTML = '';
    root.className = 'view-enter';
    void root.offsetWidth;
    this.view = new ViewClass(this, params);
    this.view.params = params;
    this.view.mount(root);
  },

  // Estado del actualizador (lo mantiene al día el proceso principal)
  updateState: { status: 'idle' },
  modal: null,

  // ---------- Entrada ----------
  input(button) {
    document.body.classList.add('hide-cursor');
    this.pointer = false;
    // Con una ventana de aviso abierta, el mando solo la controla a ella
    if (this.modal) return this.modal.button(button);
    if (!this.view) return;
    this.view.button(button);
  },

  // Ventana de aviso manejable con el mando.
  // buttons: [{ id, label }]; cancel: id que devuelve B. Devuelve { result, setHtml, close }.
  openModal({ title, html = '', buttons = [], cancel = null }) {
    this.modal?.close(null);
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>${escapeHtml(title)}</h2>
      <div class="modal-body">${html}</div>
      <div class="modal-buttons">${buttons.map((b, i) => `<button class="modal-btn" data-i="${i}">${escapeHtml(b.label)}</button>`).join('')}</div>
    </div>`;
    document.body.appendChild(el);
    const btnEls = [...el.querySelectorAll('.modal-btn')];
    let idx = 0;
    let resolve;
    const result = new Promise((r) => (resolve = r));
    const focus = (i) => {
      if (!btnEls.length) return;
      idx = (i + btnEls.length) % btnEls.length;
      btnEls.forEach((b, j) => b.classList.toggle('focused', j === idx));
    };
    const modal = {
      result,
      setHtml: (h) => { el.querySelector('.modal-body').innerHTML = h; },
      close: (value) => {
        if (this.modal === modal) this.modal = null;
        el.remove();
        resolve(value);
      },
      button: (b) => {
        if (b === 'left' || b === 'up') { sounds.move(); focus(idx - 1); }
        else if (b === 'right' || b === 'down') { sounds.move(); focus(idx + 1); }
        else if (b === 'a' && btnEls.length) { sounds.select(); modal.close(buttons[idx].id); }
        else if (b === 'b' && cancel !== null) { sounds.back(); modal.close(cancel); }
      },
    };
    btnEls.forEach((b, i) => {
      b.addEventListener('mouseenter', () => focus(i));
      b.addEventListener('click', () => modal.close(buttons[i].id));
    });
    focus(0);
    this.modal = modal;
    return modal;
  },

  setPadNames(names = []) {
    this.padStyle = names.some((n) => /ps[345]|dualshock|dualsense|playstation|wireless controller/i.test(n)) ? 'ps' : 'xbox';
    document.body.classList.toggle('ps', this.padStyle === 'ps');
    if (this.lastHints) this.hints(this.lastHints);
  },

  // Nombre de un botón (en disposición Xbox) según el mando conectado
  glyph(btn) {
    return (this.padStyle === 'ps' && PS_GLYPHS[btn]) || btn;
  },

  // ---------- Pie con ayudas de botones ----------
  hints(list) {
    this.lastHints = list;
    $('#hints').innerHTML = list
      .map(([btn, label]) => {
        const text = this.glyph(btn);
        return `<span class="hint"><span class="btn-glyph ${btn.toLowerCase()} ${text.length > 1 ? 'wide' : ''}">${text}</span>${label}</span>`;
      })
      .join('');
  },

  toast(msg, { error = false, ms = 3200 } = {}) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `show${error ? ' error' : ''}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (t.className = ''), ms);
  },
};

// ---------- Fondo con fundido entre dos capas ----------
const layers = [...document.querySelectorAll('.bg-layer')];
let front = 0;
let bgToken = 0;

function preload(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Prueba las URLs en orden y muestra la primera que cargue
export async function setBackground(urls, { color, pixel = false } = {}) {
  const token = ++bgToken;
  if (color) document.documentElement.style.setProperty('--console', color);
  for (const url of (urls || []).flat().filter(Boolean)) {
    try {
      const img = await preload(url);
      if (token !== bgToken) return;
      // Imágenes pequeñas (capturas de 8/16 bits) se escalan sin suavizar
      const small = img.naturalWidth < 700;
      const next = layers[1 - front];
      next.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
      next.classList.toggle('pixel', pixel && small);
      next.classList.add('visible');
      layers[front].classList.remove('visible');
      front = 1 - front;
      return;
    } catch { /* probar la siguiente */ }
  }
  if (token !== bgToken) return;
  layers.forEach((l) => l.classList.remove('visible'));
}

// ---------- Carátulas: caché solo en memoria durante la sesión ----------
const artCache = new Map();
export function getArtwork(consoleId, games) {
  const key = consoleId;
  const missing = games.filter((g) => !artCache.get(key)?.has(g.fileName));
  if (!missing.length) return Promise.resolve(artCache.get(key));
  return api.resolveArtwork(consoleId, missing.map((g) => g.fileName)).then((res) => {
    const map = artCache.get(key) || new Map();
    for (const [name, urls] of Object.entries(res)) map.set(name, urls);
    artCache.set(key, map);
    return map;
  });
}

const SOURCES = { steam: 'Steam', epic: 'Epic', manual: 'PC' };

export function coverHtml(game, consoleDef) {
  const badge = game.source ? `<span class="src-badge ${game.source}">${SOURCES[game.source]}</span>` : '';
  return `<div class="cover focusable${game.favorite ? ' is-fav' : ''}" style="--c:${consoleDef.color};--box:${consoleDef.box}">
    <div class="placeholder">${escapeHtml(game.title)}</div>
    <img alt="" loading="lazy" decoding="async">
    <span class="fav">★</span>
    ${badge}
  </div>`;
}

// Pone la carátula probando cada URL de respaldo hasta que una cargue
export function applyCover(el, urls) {
  const img = el.querySelector('img');
  const list = urls ? [urls.boxart].flat().filter(Boolean) : [];
  if (!img || !list.length || img.dataset.src === list.join('|')) return;
  img.dataset.src = list.join('|');
  let i = 0;
  img.onload = () => {
    img.classList.add('loaded');
    el.classList.add('has-art');
  };
  img.onerror = () => {
    i += 1;
    if (i < list.length) img.src = list[i];
    else img.remove();
  };
  img.src = list[0];
}

// ---------- Foto de la consola (recortada, sin fondo blanco) ----------
let artToken = 0;
export async function setConsoleArt(url) {
  const token = ++artToken;
  const el = $('#console-art');
  if (!url) {
    el.classList.remove('visible');
    return;
  }
  const blobUrl = await cutout(url).catch(() => null);
  if (token !== artToken) return;
  if (!blobUrl) return el.classList.remove('visible');
  el.classList.remove('visible');
  // Reiniciar la animación de entrada
  void el.offsetWidth;
  el.src = blobUrl;
  el.classList.add('visible');
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// mouseenter que solo cuenta si el usuario está usando el ratón
export function onHover(el, fn) {
  el.addEventListener('mouseenter', () => app.pointer && fn());
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- Teclado y ratón como respaldo ----------
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b',
  f: 'y', F: 'y', x: 'x', X: 'x', q: 'lb', Q: 'lb', e: 'rb', E: 'rb', Tab: 'start',
};
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Escape' || e.key === 'Enter') e.target.blur();
    return;
  }
  const b = KEYMAP[e.key];
  if (b) {
    e.preventDefault();
    app.input(b);
  }
});
window.addEventListener('mousemove', (e) => {
  if (!e.movementX && !e.movementY) return;
  app.pointer = true;
  document.body.classList.remove('hide-cursor');
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

api.onButton((b) => {
  if (document.activeElement?.tagName === 'INPUT' && ['a', 'b'].includes(b)) {
    document.activeElement.blur();
    return;
  }
  app.input(b);
});
api.onPadConnection((on, names = []) => {
  $('#pad-status').classList.toggle('on', on);
  $('#pad-status').title = names.join(', ') || 'Sin mando';
  app.setPadNames(names);
  app.toast(on ? `Mando conectado${names[0] ? `: ${names[0]}` : ''}` : 'Mando desconectado');
});
api.onActive((active) => (app.active = active));
api.onUpdateState((st) => {
  app.updateState = st;
  app.view?.onUpdateState?.(st);
});
api.onUpdatePrompt((st) => promptUpdate(st));
api.onGameExit(async ({ error }) => {
  if (error) app.toast(`No se pudo abrir el juego: ${error}`, { error: true, ms: 6000 });
  await app.refresh();
  app.view?.onGameExit?.();
});

// ---------- Reloj ----------
function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
setInterval(tick, 10_000);
tick();

// ---------- Arranque ----------
(async () => {
  const state = await app.refresh();
  app.updateState = await api.getUpdateState();
  $('#pad-status').classList.toggle('on', state.padConnected);
  app.setPadNames(state.padNames);
  if (!state.settings.setupDone) app.mount(SetupView, {});
  else app.mount(HomeView, {});
})();

export { api, HomeView, GamesView, SettingsView };
