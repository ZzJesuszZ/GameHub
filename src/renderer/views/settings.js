import { app, api, setBackground, escapeHtml } from '../app.js';
import { PanelList } from './panel.js';
import { sounds } from '../sound.js';
import { downloadAndInstall, confirmInstall } from '../update.js';

function updateStatusText(st) {
  switch (st.status) {
    case 'disabled': return 'Las actualizaciones funcionan en la versión instalada de GameHub';
    case 'checking': return 'Buscando versiones nuevas…';
    case 'none': return 'Tienes la última versión';
    case 'available': return `Versión ${st.version} disponible`;
    case 'downloading': return `Descargando la versión ${st.version || ''}… ${st.percent || 0}%`;
    case 'downloaded': return `Versión ${st.version} lista para instalar`;
    case 'error': return `No se pudo comprobar: ${st.error || 'error desconocido'}`;
    default: return 'Descarga solo las partes que cambian; nada se instala sin tu permiso';
  }
}

function updateActionHtml(st) {
  switch (st.status) {
    case 'checking': return '…';
    case 'available': return '<b>Descargar e instalar</b>';
    case 'downloading': return `<div class="progress"><div style="width:${st.percent || 0}%"></div></div>`;
    case 'downloaded': return '<b>Reiniciar e instalar</b>';
    case 'disabled': return '';
    default: return 'Buscar';
  }
}

export const COMBOS = [
  { buttons: ['back', 'start'], xbox: 'View + Menu', ps: 'Share + Options' },
  { buttons: ['guide'], xbox: 'Botón Xbox', ps: 'Botón PS' },
  { buttons: ['lb', 'rb', 'start'], xbox: 'LB + RB + Menu', ps: 'L1 + R1 + Options' },
  { buttons: ['lb', 'rb', 'back'], xbox: 'LB + RB + View', ps: 'L1 + R1 + Share' },
  { buttons: ['lt', 'rt', 'start'], xbox: 'LT + RT + Menu', ps: 'L2 + R2 + Options' },
];
const HOLD_TIMES = [500, 1000, 1500, 2000];
export const THEMES = [
  { id: 'consola', label: 'Neón · color de cada consola' },
  { id: 'synthwave', label: 'Neón · cian + magenta' },
  { id: 'mezcla', label: 'Neón · mezcla' },
  { id: 'clasico', label: 'Clásico (sin neón)' },
];

export function comboLabel(buttons) {
  return COMBOS.find((c) => c.buttons.join() === buttons.join())?.[app.padStyle] || buttons.join(' + ');
}

const cycle = (list, current, dir) => list[(list.indexOf(current) + dir + list.length) % list.length];

// Filas de emuladores reutilizadas por Setup
export function emulatorItems(progress, { selectable = null } = {}) {
  const emu = (id) => app.state.emulators.find((x) => x.id === id);
  return app.state.emulators.map((e) => ({
    id: `emu-${e.id}`,
    label: e.name,
    sub: () => (emu(e.id).external ? `${e.desc} · usando el tuyo: ${emu(e.id).path}` : e.desc),
    value: () => {
      const p = progress[e.id];
      if (p && !p.done) {
        return p.error
          ? `<span style="color:var(--danger)">${escapeHtml(p.message)}</span>`
          : `<span>${escapeHtml(p.message || '')}</span><div class="progress"><div style="width:${Math.round(p.progress * 100)}%"></div></div>`;
      }
      const st = emu(e.id);
      const label = st.external ? (st.installed ? 'El tuyo' : 'El tuyo · faltan cores') : st.installed ? 'Instalado' : 'No instalado';
      const status = `<span class="status-dot ${st.installed ? 'ok' : ''}"></span>${label}`;
      return selectable ? `${status}<span class="check ${selectable.has(e.id) ? 'on' : ''}"></span>` : status;
    },
    emuId: e.id,
  }));
}

export async function installEmulators(ids, progress, list) {
  const off = api.onInstallProgress((p) => {
    progress[p.id] = p;
    list.refresh();
  });
  try {
    const { errors, status } = await api.installEmulators(ids);
    app.state.emulators = status;
    for (const id of ids) progress[id] = { done: !errors[id], ...(errors[id] ? { error: true, message: errors[id] } : {}) };
    await app.refresh();
    list.refresh();
    return errors;
  } finally {
    off();
  }
}

export class SettingsView {
  constructor(appRef, params) {
    this.params = params;
    this.progress = {};
    this.installing = false;
  }

  mount(root) {
    setBackground([], { color: '#2b2f3a' });
    root.innerHTML = `
      <section class="panel-view">
        <div class="panel">
          <div class="panel-head">
            <h1>Ajustes</h1>
            <p>Mantén <b>${escapeHtml(comboLabel(app.state.settings.combo))}</b> en el mando para abrir GameHub desde cualquier sitio. Durante una partida, mantenlo ${app.state.settings.comboQuitGameMs / 1000} s para salir del juego.</p>
          </div>
          <div class="panel-list" id="list"></div>
        </div>
      </section>`;
    this.manual = [];
    this.list = new PanelList(root.querySelector('#list'), this.items(), { onChange: (it) => this.updateHints(it) });
    root.querySelector('#list').addEventListener('change', (e) => {
      if (e.target.id === 'sgdb-key') this.save({ steamGridDbKey: e.target.value.trim() });
      if (e.target.dataset.pcId) this.renamePc(e.target.dataset.pcId, e.target.value);
    });
    root.querySelector('#list').addEventListener('click', (e) => {
      if (e.target.id === 'sgdb-paste') this.pasteSgdbKey();
    });
    this.loadManual();
  }

  async loadManual() {
    this.manual = await api.listPcGames();
    this.rebuild();
  }

  // Vuelve a generar la lista conservando la fila enfocada
  rebuild() {
    const idx = this.list.idx;
    this.list.items = this.items();
    this.list.idx = Math.min(idx, this.list.items.length - 1);
    this.list.render();
  }

  async addPc() {
    const entry = await api.addPcGame();
    if (!entry) return;
    await app.refresh();
    app.toast(`Añadido: ${entry.title}`);
    await this.loadManual();
  }

  async renamePc(id, title) {
    if (!title.trim()) return;
    await api.renamePcGame(id, title);
    await app.refresh();
    const e = this.manual.find((x) => x.id === id);
    if (e) e.title = title.trim();
  }

  async removePc(id) {
    await api.removePcGame(id);
    await app.refresh();
    app.toast('Juego quitado de GameHub (no se borra del disco)');
    await this.loadManual();
  }

  updateHints(it) {
    if (it?.pcId) {
      app.hints([['A', 'Renombrar'], ['Y', 'Quitar'], ['B', 'Atrás']]);
      return;
    }
    if (it?.openExternal) {
      app.hints([['A', 'Abrir web'], ['B', 'Atrás']]);
      return;
    }
    if (it?.sgdbKey) {
      app.hints([['A', 'Escribir'], ['X', 'Pegar'], ['B', 'Atrás']]);
      return;
    }
    if (it?.openEmu) {
      app.hints([['A', 'Abrir'], ['B', 'Atrás']]);
      return;
    }
    if (it?.emuId) {
      const st = app.state.emulators.find((e) => e.id === it.emuId);
      app.hints([
        ['A', st.installed ? 'Reparar' : 'Descargar'],
        ['X', 'Usar uno ya instalado'],
        ...(st.external ? [['Y', 'Usar el de GameHub']] : []),
        ['B', 'Atrás'],
      ]);
    } else {
      app.hints([['A', 'Seleccionar'], ['←→', 'Cambiar'], ['B', 'Atrás']]);
    }
  }

  async pickExe(id) {
    try {
      app.state.emulators = await api.pickEmulatorExe(id);
      await app.refresh();
    } catch (e) {
      sounds.error();
      app.toast(e.message.replace(/^.*Error: /, ''), { error: true });
    }
    this.updateHints(this.list.items[this.list.idx]);
  }

  async clearExe(id) {
    app.state.emulators = await api.clearEmulatorExe(id);
    await app.refresh();
    this.updateHints(this.list.items[this.list.idx]);
  }

  async openEmulatorStandalone(emuId, label) {
    try {
      await api.openEmulator(emuId);
      app.toast(`Abriendo ${label}… vuelve a GameHub al cerrarlo`);
    } catch (e) {
      sounds.error();
      app.toast(e.message.replace(/^.*Error: /, ''), { error: true });
    }
  }

  async pasteSgdbKey() {
    const text = (await api.pasteClipboard()).trim();
    if (!text) {
      sounds.error();
      app.toast('El portapapeles está vacío. Copia la clave desde la web y vuelve a intentarlo', { error: true });
      return;
    }
    await this.save({ steamGridDbKey: text });
    const input = document.getElementById('sgdb-key');
    if (input) input.value = text;
    app.toast('Clave de SteamGridDB pegada y guardada');
  }

  async save(patch) {
    app.state.settings = await api.saveSettings(patch);
    sounds.enabled = app.state.settings.sounds;
  }

  items() {
    const s = () => app.state.settings;
    return [
      { section: 'Biblioteca' },
      {
        label: 'Carpeta de juegos', sub: s().romsDir,
        value: () => 'Cambiar',
        a: async () => {
          const dir = await api.pickFolder(s().romsDir);
          if (!dir) return;
          await this.save({ romsDir: dir });
          await this.rescan();
          this.list.items.find((i) => i.label === 'Carpeta de juegos').sub = dir;
        },
      },
      { label: 'Abrir carpeta de juegos', sub: 'Una subcarpeta por consola: nes, snes, gba, ps2…', a: () => api.openFolder('roms') },
      { label: 'Volver a buscar juegos', value: () => `${Object.values(app.state.counts).reduce((a, b) => a + b, 0)} juegos`, a: () => this.rescan() },
      { label: 'Abrir carpeta de BIOS', sub: 'PS1 → bios\\psx · PS2 → bios\\ps2 (necesarias para esas consolas)', a: () => api.openFolder('bios') },

      { section: 'Emuladores' },
      ...emulatorItems(this.progress).flatMap((it) => [
        {
          ...it,
          x: () => this.pickExe(it.emuId),
          y: () => this.clearExe(it.emuId),
          a: async () => {
            if (this.installing) return;
            this.installing = true;
            const errors = await installEmulators([it.emuId], this.progress, this.list);
            this.installing = false;
            app.toast(errors[it.emuId] ? `Error instalando ${it.label}` : `${it.label} listo`, { error: !!errors[it.emuId] });
          },
        },
        {
          openEmu: it.emuId,
          label: `Abrir ${it.label}`,
          sub: 'Sin ningún juego, para cambiar sus ajustes (mando, vídeo, BIOS…)',
          value: () => '▶',
          a: () => this.openEmulatorStandalone(it.emuId, it.label),
        },
      ]),
      { label: 'Abrir carpeta de emuladores', a: () => api.openFolder('emulators') },

      { section: 'Mando e inicio' },
      {
        label: 'Iniciar con Windows', sub: 'Se queda en segundo plano esperando el combo del mando',
        value: () => `<span class="toggle ${s().autostart ? 'on' : ''}"></span>`,
        a: () => this.save({ autostart: !s().autostart }),
        left: () => this.save({ autostart: !s().autostart }),
        right: () => this.save({ autostart: !s().autostart }),
      },
      {
        label: 'Combo para abrir GameHub',
        value: () => `<span class="arrows">${escapeHtml(comboLabel(s().combo))}</span>`,
        left: () => this.save({ combo: cycle(COMBOS, COMBOS.find((c) => c.buttons.join() === s().combo.join()) || COMBOS[0], -1).buttons }),
        right: () => this.save({ combo: cycle(COMBOS, COMBOS.find((c) => c.buttons.join() === s().combo.join()) || COMBOS[0], 1).buttons }),
        a: () => this.save({ combo: cycle(COMBOS, COMBOS.find((c) => c.buttons.join() === s().combo.join()) || COMBOS[0], 1).buttons }),
      },
      {
        label: 'Tiempo manteniendo el combo',
        value: () => `<span class="arrows">${(s().comboHoldMs / 1000).toLocaleString('es-ES')} s</span>`,
        left: () => this.save({ comboHoldMs: cycle(HOLD_TIMES, s().comboHoldMs, -1) }),
        right: () => this.save({ comboHoldMs: cycle(HOLD_TIMES, s().comboHoldMs, 1) }),
        a: () => this.save({ comboHoldMs: cycle(HOLD_TIMES, s().comboHoldMs, 1) }),
      },
      {
        label: 'Sonidos de la interfaz',
        value: () => `<span class="toggle ${s().sounds ? 'on' : ''}"></span>`,
        a: () => this.save({ sounds: !s().sounds }),
        left: () => this.save({ sounds: !s().sounds }),
        right: () => this.save({ sounds: !s().sounds }),
      },

      { section: 'Juegos de PC' },
      {
        label: 'Añadir juego de PC', sub: 'Elige su .exe o un acceso directo (.lnk / .url). Steam y Epic se detectan solos',
        value: () => '+ Añadir', a: () => this.addPc(),
      },
      ...(this.manual || []).map((e) => ({
        pcId: e.id,
        label: e.title,
        sub: e.target,
        value: () => `<input type="text" data-pc-id="${e.id}" value="${escapeHtml(e.title)}" title="Nombre en GameHub">`,
        a: () => this.list.container.querySelector(`input[data-pc-id="${e.id}"]`)?.focus(),
        y: () => this.removePc(e.id),
      })),

      { section: 'Apariencia' },
      {
        label: 'Estilo de la interfaz', sub: 'Se aplica al momento',
        value: () => `<span class="arrows">${THEMES.find((t) => t.id === s().theme)?.label || THEMES[0].label}</span>`,
        left: () => this.setTheme(-1),
        right: () => this.setTheme(1),
        a: () => this.setTheme(1),
      },

      { section: 'Actualizaciones' },
      { label: 'Versión instalada', value: () => `GameHub ${escapeHtml(app.updateState.current || '')}` },
      {
        label: 'Actualizar GameHub',
        sub: () => updateStatusText(app.updateState),
        value: () => updateActionHtml(app.updateState),
        a: () => this.updateAction(),
      },

      { section: 'Imágenes' },
      {
        label: 'Obtener clave de SteamGridDB', openExternal: true,
        sub: 'Abre la web para crear una cuenta gratis (puedes entrar con tu Steam) y generar tu clave',
        value: () => 'Abrir web ↗',
        a: () => api.openExternal('steamgriddb'),
      },
      {
        label: 'Clave de SteamGridDB (opcional)', sgdbKey: true,
        sub: s().steamGridDbKey ? 'Activada: fondos en alta calidad' : 'Sin clave: se usan capturas de libretro. Pégala aquí tras generarla',
        value: () => `<input type="text" id="sgdb-key" placeholder="Pega aquí tu clave" value="${escapeHtml(s().steamGridDbKey)}">
          <button type="button" class="inline-btn" id="sgdb-paste">Pegar</button>`,
        a: () => document.getElementById('sgdb-key')?.focus(),
        x: () => this.pasteSgdbKey(),
      },

      { section: 'GameHub' },
      { label: 'Ocultar en la bandeja', sub: 'Sigue escuchando el mando', a: () => api.hide() },
      { label: 'Repetir asistente inicial', a: async () => { await this.save({ setupDone: false }); location.reload(); } },
      { label: 'Salir de GameHub', cls: 'danger', sub: 'El combo del mando dejará de funcionar hasta que lo abras', a: () => api.quit() },
    ];
  }

  async updateAction() {
    const st = app.updateState;
    if (st.status === 'available') return downloadAndInstall();
    if (st.status === 'downloaded') return confirmInstall();
    if (['checking', 'downloading', 'disabled'].includes(st.status)) return;
    app.updateState = await api.checkUpdate();
    this.list.refresh();
    if (app.updateState.status === 'none') app.toast('Tienes la última versión de GameHub');
  }

  onUpdateState() {
    this.list.refresh();
  }

  async setTheme(dir) {
    const current = THEMES.findIndex((t) => t.id === app.state.settings.theme);
    const next = THEMES[(Math.max(0, current) + dir + THEMES.length) % THEMES.length];
    app.applyTheme(next.id);
    await this.save({ theme: next.id });
    this.list.refresh();
  }

  async rescan() {
    await api.scan();
    await app.refresh();
    const total = Object.values(app.state.counts).reduce((a, b) => a + b, 0);
    app.toast(`${total} juegos encontrados`);
  }

  button(b) {
    if (this.list.button(b)) return;
    if (b === 'b' || b === 'start') app.back();
  }
}
