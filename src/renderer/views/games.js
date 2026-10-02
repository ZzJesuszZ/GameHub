import { app, api, setBackground, getArtwork, coverHtml, applyCover, escapeHtml, plural, onHover } from '../app.js';
import { SettingsView } from './settings.js';
import { sounds } from '../sound.js';

export class GamesView {
  constructor(appRef, params) {
    this.params = params;
    this.consoleId = params.consoleId;
    this.idx = params.idx || 0;
    this.onlyFavs = !!params.onlyFavs;
    this.bgTimer = null;
    this.art = new Map();
  }

  async mount(root) {
    this.root = root;
    this.c = app.console(this.consoleId);
    this.all = await api.listGames(this.consoleId);
    this.render();
    this.onResize = () => { this.layout(); this.setFocus(this.idx, false); };
    window.addEventListener('resize', this.onResize);
  }

  get games() {
    return this.onlyFavs ? this.all.filter((g) => g.favorite) : this.all;
  }

  render() {
    const c = this.c;
    const games = this.games;
    document.documentElement.style.setProperty('--console', c.color);
    const missingEmu = !c.ready;

    this.root.innerHTML = `
      <section class="games">
        <div class="games-head">
          <div class="hero-eyebrow">${escapeHtml(c.name)}${this.onlyFavs ? ' · Favoritos' : ''}</div>
          <h1 class="hero-title" id="g-title">${escapeHtml(c.name)}</h1>
          <div class="hero-sub" id="g-sub"></div>
        </div>
        ${games.length ? `
          <div class="grid-wrap"><div class="grid" id="grid">
            ${games.map((g) => `<div class="cover-cell">${coverHtml(g, c)}<div class="cover-title">${escapeHtml(g.title)}</div></div>`).join('')}
          </div></div>` : `
          <div class="empty-state">
            <h2>${this.onlyFavs ? 'Sin favoritos' : 'No hay juegos'}</h2>
            ${this.onlyFavs
              ? `<p>Pulsa <b>${app.glyph('Y')}</b> sobre un juego para marcarlo como favorito.</p>`
              : c.pc
                ? `<p>No se encontraron juegos de Steam ni de Epic Games instalados.</p>
                   <p>Puedes añadir otros juegos en Ajustes → Juegos de PC. Pulsa <b>${app.glyph('A')}</b> para ir y <b>${app.glyph('X')}</b> para volver a buscar.</p>`
                : `<p>Copia tus juegos en <code>${escapeHtml(app.state.settings.romsDir)}\\${c.id}</code></p>
                 <p>Formatos: ${c.exts.join(' ')}</p>
                 <p>Pulsa <b>${app.glyph('A')}</b> para abrir la carpeta y <b>${app.glyph('X')}</b> para volver a buscar.</p>
                 ${c.homebrew ? `<p>GameHub no distribuye juegos. Pulsa <b>${app.glyph('Y')}</b> para ver juegos homebrew gratuitos y legales en itch.io, una web segura.</p>` : ''}`}
            ${missingEmu ? `<p class="pill warn">Falta instalar el emulador · pulsa ${app.glyph('Menu')} para ir a Ajustes</p>` : ''}
          </div>`}
      </section>`;

    this.cells = [...this.root.querySelectorAll('.cover-cell')];
    this.covers = this.cells.map((cell) => cell.querySelector('.cover'));
    this.cells.forEach((cell, i) => {
      onHover(cell, () => this.setFocus(i, false));
      cell.addEventListener('click', () => { this.setFocus(i, false); this.launch(); });
    });

    if (games.length) {
      this.idx = Math.min(this.idx, games.length - 1);
      this.layout();
      this.setFocus(this.idx, false);
      this.loadArt();
    } else {
      document.getElementById('g-sub').innerHTML = missingEmu ? '<span class="pill warn">Emulador no instalado</span>' : '';
      setBackground([], { color: c.color });
    }
    this.updateHints();
  }

  layout() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const box = this.c.box;
    const cellRem = box >= 1.2 ? 16 : box >= 0.95 ? 13 : 11.5;
    this.cols = Math.max(3, Math.floor((grid.clientWidth - 8 * rem) / (cellRem * rem)));
    grid.style.setProperty('--cols', this.cols);
  }

  async loadArt() {
    const art = await getArtwork(this.consoleId, this.all).catch(() => null);
    if (!art) return;
    this.art = art;
    this.games.forEach((g, i) => applyCover(this.covers[i], art.get(g.fileName)));
    this.updateBackground();
  }

  setFocus(i, sound = true) {
    const games = this.games;
    if (!games.length) return;
    i = Math.max(0, Math.min(i, games.length - 1));
    if (sound && i !== this.idx) sounds.move();
    this.cells[this.idx]?.classList.remove('focused-cell');
    this.covers[this.idx]?.classList.remove('focused');
    this.idx = i;
    this.params.idx = i;
    this.cells[i].classList.add('focused-cell');
    this.covers[i].classList.add('focused');
    this.scrollTo(i);

    const g = games[i];
    document.getElementById('g-title').textContent = g.title;
    const played = g.playCount ? plural(g.playCount, 'partida', 'partidas') : 'Sin jugar';
    document.getElementById('g-sub').innerHTML = `
      <span class="pill">${i + 1} / ${games.length}</span>
      <span>${played}</span>
      ${g.favorite ? '<span class="pill" style="color:var(--btn-y)">★ Favorito</span>' : ''}
      ${this.c.ready ? '' : '<span class="pill warn">Emulador no instalado</span>'}`;

    clearTimeout(this.bgTimer);
    this.bgTimer = setTimeout(() => this.updateBackground(), 140);
  }

  // Desplaza la cuadrícula para que la fila enfocada quede visible
  scrollTo(i) {
    const grid = document.getElementById('grid');
    const wrap = grid.parentElement;
    const cell = this.cells[i];
    const row = Math.floor(i / this.cols);
    const offset = row === 0 ? 0 : cell.offsetTop - wrap.clientHeight * 0.18;
    grid.style.transform = `translateY(${-Math.max(0, offset)}px)`;
  }

  async updateBackground() {
    const g = this.games[this.idx];
    if (!g) return;
    const urls = this.art.get(g.fileName);
    const token = g.path;
    this.bgFor = token;
    const hero = await api.heroArtwork(g.title).catch(() => null);
    if (this.bgFor !== token) return;
    setBackground([hero, urls?.snap, urls?.title, urls?.boxart], { color: this.c.color, pixel: true });
  }

  async launch() {
    const g = this.games[this.idx];
    if (!g) return;
    if (!this.c.ready) {
      sounds.error();
      app.toast(`Primero instala el emulador en Ajustes (botón ${app.glyph('Menu')})`, { error: true });
      return;
    }
    sounds.launch();
    app.toast(`Abriendo ${g.title}…`, { ms: 2500 });
    try {
      await api.launch(g.path);
    } catch (e) {
      sounds.error();
      app.toast(e.message.replace(/^.*Error: /, ''), { error: true, ms: 5000 });
    }
  }

  async toggleFavorite() {
    const g = this.games[this.idx];
    if (!g) return;
    const updated = await api.toggleFavorite(g.path);
    const src = this.all.find((x) => x.path === g.path);
    src.favorite = updated.favorite;
    sounds.select();
    if (this.onlyFavs && !updated.favorite) return this.render();
    this.covers[this.idx].classList.toggle('is-fav', updated.favorite);
    this.setFocus(this.idx, false);
  }

  switchConsole(dir) {
    const list = app.state.consoles;
    const withGames = list.filter((c) => app.state.counts[c.id] > 0);
    const pool = withGames.length ? withGames : list;
    let i = pool.findIndex((c) => c.id === this.consoleId);
    i = (i + dir + pool.length) % pool.length;
    sounds.select();
    app.go(GamesView, { consoleId: pool[i].id }, { replace: true });
  }

  updateHints() {
    const hasGames = this.games.length > 0;
    const showHomebrew = !hasGames && !this.onlyFavs && !this.c.pc && this.c.homebrew;
    app.hints([
      ...(hasGames ? [['A', 'Jugar'], ['Y', 'Favorito']] : [['A', this.c.pc ? 'Ajustes' : 'Abrir carpeta']]),
      ...(showHomebrew ? [['Y', 'Juegos gratis']] : []),
      ['X', hasGames ? (this.onlyFavs ? 'Ver todos' : 'Solo favoritos') : 'Buscar juegos'],
      ['LB', ''], ['RB', 'Cambiar consola'],
      ['B', 'Atrás'],
    ]);
  }

  async button(b) {
    if (!this.all) return;
    const hasGames = this.games.length > 0;
    switch (b) {
      case 'left': return this.setFocus(this.idx - 1);
      case 'right': return this.setFocus(this.idx + 1);
      case 'up': return this.idx - this.cols >= 0 && this.setFocus(this.idx - this.cols);
      case 'down': {
        const next = Math.min(this.idx + this.cols, this.games.length - 1);
        if (Math.floor(next / this.cols) > Math.floor(this.idx / this.cols)) this.setFocus(next);
        return;
      }
      case 'a':
        if (hasGames) return this.launch();
        if (this.c.pc) return app.go(SettingsView);
        if (!this.onlyFavs) return api.openFolder('roms');
        return;
      case 'y':
        if (hasGames) return this.toggleFavorite();
        if (!this.onlyFavs && !this.c.pc && this.c.homebrew) { sounds.select(); return api.openExternal(`homebrew-${this.c.id}`); }
        return;
      case 'x':
        if (!hasGames && !this.onlyFavs) {
          await api.scan();
          await app.refresh();
          this.all = await api.listGames(this.consoleId);
          app.toast(`${plural(this.all.length, 'juego encontrado', 'juegos encontrados')}`);
        } else {
          this.onlyFavs = !this.onlyFavs;
          this.params.onlyFavs = this.onlyFavs;
          this.idx = 0;
          sounds.select();
        }
        return this.render();
      case 'lb': return this.switchConsole(-1);
      case 'rb': return this.switchConsole(1);
      case 'b': return app.back();
      case 'start': sounds.select(); return app.go(SettingsView);
    }
  }

  async onGameExit() {
    this.all = await api.listGames(this.consoleId);
    this.render();
  }

  unmount() {
    clearTimeout(this.bgTimer);
    window.removeEventListener('resize', this.onResize);
  }
}
