import { escapeHtml, onHover } from '../app.js';
import { sounds } from '../sound.js';

// Lista vertical navegable con mando, usada por Ajustes y Setup.
// items: { section } | { id, label, sub?: string|fn, value?(): html, a?(), x?(), y?(), left?(), right?(), cls? }
const text = (v) => (typeof v === 'function' ? v() : v);

export class PanelList {
  constructor(container, items, { onChange } = {}) {
    this.container = container;
    this.items = items;
    this.idx = 0;
    this.onChange = onChange;
    this.render();
  }

  render() {
    this.container.innerHTML = `<div class="panel-list-inner">${this.items.map((it, i) => (it.section
      ? `<div class="section-label">${escapeHtml(it.section)}</div>`
      : `<div class="item ${it.cls || ''}" data-i="${i}">
          <div class="label">${escapeHtml(it.label)}<small>${escapeHtml(text(it.sub) || '')}</small></div>
          <div class="value">${it.value ? it.value() : ''}</div>
        </div>`)).join('')}</div>`;
    this.inner = this.container.firstElementChild;
    this.container.querySelectorAll('.item').forEach((el) => {
      const i = Number(el.dataset.i);
      onHover(el, () => this.focus(i, false));
      el.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        this.focus(i, false);
        this.button('a');
      });
    });
    if (this.items[this.idx]?.section || !this.items[this.idx]) this.idx = this.next(-1, 1);
    this.focus(this.idx, false);
  }

  // Refresca solo los valores (sin perder el foco ni el scroll)
  refresh() {
    this.container.querySelectorAll('.item').forEach((el) => {
      const it = this.items[Number(el.dataset.i)];
      if (it.value) {
        const v = el.querySelector('.value');
        const html = it.value();
        if (!v.contains(document.activeElement)) v.innerHTML = html;
      }
      el.querySelector('.label small').textContent = text(it.sub) || '';
    });
  }

  next(from, dir) {
    let i = from + dir;
    while (i >= 0 && i < this.items.length && this.items[i].section) i += dir;
    return i >= 0 && i < this.items.length ? i : from;
  }

  focus(i, sound = true) {
    if (sound && i !== this.idx) sounds.move();
    this.idx = i;
    this.container.querySelectorAll('.item').forEach((el) => el.classList.toggle('focused', Number(el.dataset.i) === i));
    const el = this.container.querySelector(`.item[data-i="${i}"]`);
    if (el) {
      const target = el.offsetTop - this.container.clientHeight * 0.35;
      const max = Math.max(0, this.inner.scrollHeight - this.container.clientHeight + 24);
      this.inner.style.transform = `translateY(${-Math.min(max, Math.max(0, target))}px)`;
    }
    this.onChange?.(this.items[i]);
  }

  button(b) {
    const it = this.items[this.idx];
    switch (b) {
      case 'up': return this.focus(this.next(this.idx, -1));
      case 'down': return this.focus(this.next(this.idx, 1));
      case 'left': if (it.left) { sounds.move(); it.left(); this.refresh(); } return true;
      case 'right': if (it.right) { sounds.move(); it.right(); this.refresh(); } return true;
      case 'a':
      case 'x':
      case 'y':
        if (it[b]) { sounds.select(); Promise.resolve(it[b]()).then(() => this.refresh()); }
        return true;
    }
    return false;
  }
}
