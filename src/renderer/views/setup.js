import { app, api, setBackground, escapeHtml } from '../app.js';
import { PanelList } from './panel.js';
import { emulatorItems, installEmulators, comboLabel } from './settings.js';
import { HomeView } from './home.js';
import { sounds } from '../sound.js';

export class SetupView {
  constructor(appRef, params) {
    this.params = params;
    this.progress = {};
    this.selected = new Set(app.state.emulators.filter((e) => !e.installed).map((e) => e.id));
    this.busy = false;
  }

  mount(root) {
    setBackground([], { color: '#1f6f4a' });
    const s = app.state.settings;
    root.innerHTML = `
      <section class="panel-view">
        <div class="panel">
          <div class="panel-head">
            <h1>Bienvenido a GameHub</h1>
            <p>Vamos a preparar tus consolas. Elige dónde guardas tus juegos y qué emuladores descargar
            (se instalan dentro de GameHub, en modo portable). Los que ya tengas instalados se detectan solos; si no, márcalo con X. GameHub no descarga juegos ni BIOS: usa copias propias.</p>
            <p>Para abrir GameHub con el mando mantén <b>${escapeHtml(comboLabel(s.combo))}</b> ${s.comboHoldMs / 1000} s.</p>
          </div>
          <div class="panel-list" id="list"></div>
        </div>
      </section>`;
    this.list = new PanelList(root.querySelector('#list'), this.items());
    app.hints([['A', 'Marcar'], ['X', 'Usar uno ya instalado'], ['↑↓', 'Mover']]);
  }

  items() {
    const s = () => app.state.settings;
    return [
      { section: '1 · Tus juegos' },
      {
        label: 'Carpeta de juegos', sub: s().romsDir, value: () => 'Cambiar',
        a: async () => {
          const dir = await api.pickFolder(s().romsDir);
          if (!dir) return;
          app.state.settings = await api.saveSettings({ romsDir: dir });
          this.list.items.find((i) => i.label === 'Carpeta de juegos').sub = dir;
        },
      },
      { section: '2 · Emuladores a descargar' },
      ...emulatorItems(this.progress, { selectable: this.selected }).map((it) => ({
        ...it,
        x: async () => {
          if (this.busy) return;
          try {
            app.state.emulators = await api.pickEmulatorExe(it.emuId);
            await app.refresh();
            this.selected.delete(it.emuId);
          } catch (e) {
            sounds.error();
            app.toast(e.message.replace(/^.*Error: /, ''), { error: true });
          }
        },
        a: () => {
          if (this.busy) return;
          if (this.selected.has(it.emuId)) this.selected.delete(it.emuId); else this.selected.add(it.emuId);
        },
      })),
      { section: '3 · Listo' },
      {
        label: 'Instalar y empezar', cls: 'primary',
        sub: 'Descarga ~600 MB en total si eliges todos',
        a: () => this.finish(true),
      },
      { label: 'Empezar sin instalar nada', sub: 'Puedes instalarlos luego desde Ajustes', a: () => this.finish(false) },
    ];
  }

  async finish(install) {
    if (this.busy) return;
    this.busy = true;
    if (install && this.selected.size) {
      app.toast('Descargando emuladores… puede tardar unos minutos', { ms: 5000 });
      const errors = await installEmulators([...this.selected], this.progress, this.list);
      if (Object.keys(errors).length) {
        sounds.error();
        app.toast(`No se pudo instalar: ${Object.keys(errors).join(', ')}. Reinténtalo desde Ajustes.`, { error: true, ms: 7000 });
      }
    }
    await api.saveSettings({ setupDone: true });
    await api.scan();
    await app.refresh();
    this.busy = false;
    app.stack = [];
    app.mount(HomeView, {});
  }

  button(b) {
    if (this.busy && b !== 'up' && b !== 'down') return;
    this.list.button(b);
  }
}
