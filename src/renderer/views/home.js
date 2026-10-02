import { app, api, setBackground, setConsoleArt, getArtwork, coverHtml, applyCover, escapeHtml, plural, onHover } from '../app.js';
import { GamesView } from './games.js';
import { SettingsView } from './settings.js';
import { sounds } from '../sound.js';

// Icono para la tarjeta PC (no hay icono de libretro)
const PC_ICON = `<svg class="pc-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round">
  <rect x="6" y="9" width="52" height="34" rx="4"/><path d="M24 55h16M32 43v12"/><path d="M20 30l6-6 6 6 6-8 6 8" stroke-linecap="round"/></svg>`;

// Fotos de consolas: se piden una vez por sesión
let photosPromise = null;
const consolePhotos = () => (photosPromise ||= api.consolePhotos().catch(() => ({})));

export class HomeView {
  constructor(appRef, params) {
    this.params = params;
    this.focus = params.focus || { row: 0, idx: 0 };
    this.bgTimer = null;
  }

  mount(root) {
    const { consoles, counts, recent } = app.state;
    // Consolas con juegos primero, conservando el orden de la tabla
    this.consoles = [...consoles].sort((a, b) => (counts[b.id] > 0) - (counts[a.id] > 0));
    this.recent = recent;

    root.innerHTML = `
      <section class="home">
        <div class="hero-text">
          <div class="hero-eyebrow" id="h-eyebrow"></div>
          <h1 class="hero-title" id="h-title"></h1>
          <div class="hero-sub" id="h-sub"></div>
        </div>
        <div class="row" data-row="0">
          <div class="strip" id="consoles">
            ${this.consoles.map((c) => `
              <div class="console-tile focusable${counts[c.id] ? '' : ' empty'}" style="--c:${c.color}">
                ${c.icon ? `<img src="${c.icon}" alt="">` : PC_ICON}
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="meta">${plural(counts[c.id] || 0, 'juego', 'juegos')}</div>
              </div>`).join('')}
            <div class="console-tile focusable settings">
              <div class="gear">⚙</div>
              <div class="name">Ajustes</div>
              <div class="meta">Emuladores y mando</div>
            </div>
          </div>
        </div>
        ${recent.length ? `
          <div class="row" data-row="1">
            <div class="row-label">Jugado recientemente</div>
            <div class="strip" id="recent">
              ${recent.map((g) => `<div class="recent-tile">${coverHtml(g, app.console(g.console))}</div>`).join('')}
            </div>
          </div>` : ''}
      </section>`;

    root.querySelectorAll('.console-tile img').forEach((img) => img.addEventListener('error', () => img.remove()));
    this.rows = [
      [...root.querySelectorAll('#consoles .focusable')],
      [...root.querySelectorAll('#recent .focusable')],
    ];
    this.rows.forEach((items, row) => items.forEach((el, idx) => {
      onHover(el, () => this.setFocus(row, idx, false));
      el.addEventListener('click', () => { this.setFocus(row, idx, false); this.activate(); });
    }));

    this.fitArt = () => {
      // La foto de la consola termina justo encima de la fila de consolas
      const stripTop = document.getElementById('consoles').getBoundingClientRect().top;
      const top = window.innerHeight * 0.08;
      document.documentElement.style.setProperty('--art-h', `${Math.max(160, stripTop + 40 - top)}px`);
    };
    this.fitArt();
    window.addEventListener('resize', this.fitArt);
    this.loadRecentArt();
    if (this.focus.row >= this.rows.length || !this.rows[this.focus.row].length) this.focus = { row: 0, idx: 0 };
    this.focus.idx = Math.min(this.focus.idx, this.rows[this.focus.row].length - 1);
    this.setFocus(this.focus.row, this.focus.idx, false);
    app.hints([['A', 'Abrir'], ['Menu', 'Ajustes'], ['B', 'Ocultar']]);
  }

  async loadRecentArt() {
    const byConsole = {};
    for (const g of this.recent) (byConsole[g.console] ||= []).push(g);
    for (const [cid, games] of Object.entries(byConsole)) {
      const art = await getArtwork(cid, games).catch(() => null);
      if (!art) continue;
      this.recent.forEach((g, i) => {
        if (g.console === cid) applyCover(this.rows[1][i], art.get(g.fileName));
      });
    }
  }

  setFocus(row, idx, sound = true) {
    const items = this.rows[row];
    if (!items || !items.length) return;
    idx = Math.max(0, Math.min(idx, items.length - 1));
    if (sound && (row !== this.focus.row || idx !== this.focus.idx)) sounds.move();
    this.rows.flat().forEach((el) => el.classList.remove('focused'));
    items[idx].classList.add('focused');
    this.focus = { row, idx };
    this.params.focus = this.focus;
    document.querySelectorAll('.row').forEach((r) => r.classList.toggle('row-dim', Number(r.dataset.row) !== row));

    const strip = items[idx].parentElement.classList.contains('strip') ? items[idx].parentElement : items[idx].closest('.strip');
    const el = items[idx].closest('.recent-tile') || items[idx];
    strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });

    this.updateHero();
  }

  updateHero() {
    const { row, idx } = this.focus;
    const eyebrow = document.getElementById('h-eyebrow');
    const title = document.getElementById('h-title');
    const sub = document.getElementById('h-sub');
    clearTimeout(this.bgTimer);

    document.body.classList.toggle('pc-focus', row === 0 && !!this.consoles[idx]?.pc);
    if (row === 1) {
      setConsoleArt(null);
      const g = this.recent[idx];
      const c = app.console(g.console);
      eyebrow.textContent = 'Continuar jugando';
      title.textContent = g.title;
      sub.textContent = `${c.name} · ${plural(g.playCount, 'partida', 'partidas')}`;
      this.bgTimer = setTimeout(() => this.gameBackground(g, c), 150);
      return;
    }
    const c = this.consoles[idx];
    if (!c) {
      eyebrow.textContent = 'GameHub';
      title.textContent = 'Ajustes';
      sub.textContent = 'Carpeta de juegos, emuladores, mando, juegos de PC y estilo';
      setBackground([], { color: '#2b2f3a' });
      setConsoleArt(null);
      return;
    }
    const count = app.state.counts[c.id] || 0;
    eyebrow.textContent = c.year ? `${c.maker} · ${c.year}` : c.maker;
    title.textContent = c.name;
    sub.textContent = !c.ready
      ? `${plural(count, 'juego', 'juegos')} · falta instalar el emulador (Ajustes)`
      : count ? plural(count, 'juego', 'juegos') : 'Sin juegos todavía';
    setBackground([], { color: c.color });
    setConsoleArt(null);
    this.bgTimer = setTimeout(() => this.consoleBackground(c), 120);
  }

  async gameBackground(g, c) {
    const art = await getArtwork(c.id, [g]).catch(() => null);
    const urls = art?.get(g.fileName);
    const hero = await api.heroArtwork(g.title).catch(() => null);
    setBackground([hero, urls?.snap, urls?.title], { color: c.color, pixel: true });
  }

  // Fondo de consola: foto de la consola recortada, a la derecha
  async consoleBackground(c) {
    if (c.pc) return;
    const photos = await consolePhotos();
    if (this.consoles[this.focus.idx]?.id !== c.id || this.focus.row !== 0) return;
    setConsoleArt(photos[c.id]);
  }

  activate() {
    const { row, idx } = this.focus;
    if (row === 1) {
      const g = this.recent[idx];
      sounds.launch();
      api.launch(g.path).catch((e) => { sounds.error(); app.toast(e.message.replace(/^.*Error: /, ''), { error: true }); });
      return;
    }
    sounds.select();
    const c = this.consoles[idx];
    if (!c) app.go(SettingsView);
    else app.go(GamesView, { consoleId: c.id });
  }

  button(b) {
    const { row, idx } = this.focus;
    switch (b) {
      case 'left': return this.setFocus(row, idx - 1);
      case 'right': return this.setFocus(row, idx + 1);
      case 'up': return row > 0 && this.setFocus(row - 1, Math.min(idx, this.rows[row - 1].length - 1));
      case 'down': return this.rows[row + 1]?.length && this.setFocus(row + 1, Math.min(idx, this.rows[row + 1].length - 1));
      case 'a': return this.activate();
      case 'start': sounds.select(); return app.go(SettingsView);
      case 'b': sounds.back(); return api.hide();
    }
  }

  onGameExit() {
    app.mount(HomeView, { focus: this.focus });
  }

  unmount() {
    clearTimeout(this.bgTimer);
    document.body.classList.remove('pc-focus');
    window.removeEventListener('resize', this.fitArt);
  }
}
