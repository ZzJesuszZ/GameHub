// Resuelve URLs de imágenes online. Nada se escribe en disco: los índices de
// libretro-thumbnails y las respuestas de SteamGridDB viven solo en memoria.

const fs = require('fs');
const path = require('path');
const { byId, CONSOLES } = require('./consoles');
const settings = require('./settings');
const pcgames = require('./pcgames');

const THUMBS = 'https://thumbnails.libretro.com';
const indexes = new Map(); // libretro system -> Promise<string[]>

// Caracteres que libretro sustituye por "_" en los nombres de fichero
const sanitize = (name) => name.replace(/[&*/:`<>?\\|"]/g, '_');

const normalize = (name) => name
  .toLowerCase()
  .replace(/\s*[([][^)\]]*[)\]]/g, '')
  .replace(/^(.*?), (the|a|an)\b/, '$2 $1')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tags = (name) => (name.match(/\(([^)]*)\)/g) || []).map((t) => t.toLowerCase());

function loadIndex(system) {
  if (!indexes.has(system)) {
    const url = `${THUMBS}/${encodeURIComponent(system)}/Named_Boxarts/`;
    const p = fetch(url)
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => [...html.matchAll(/href="([^"?/][^"]*)\.png"/g)].map((m) => decodeURIComponent(m[1])))
      .catch(() => {
        indexes.delete(system); // reintentar en la próxima petición (p. ej. sin conexión)
        return [];
      });
    indexes.set(system, p);
  }
  return indexes.get(system);
}

function similarity(a, b) {
  const ta = new Set(a.split(' ')), tb = new Set(b.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter || 1);
}

const REGION_PREF = ['(usa)', '(europe)', '(usa, europe)', '(world)', '(spain)', '(japan)'];

function bestMatch(fileName, names) {
  const wanted = sanitize(fileName);
  if (names.includes(wanted)) return wanted;
  const norm = normalize(fileName);
  const fileTags = tags(fileName);
  let candidates = names.filter((n) => normalize(n) === norm);
  if (!candidates.length) {
    let best = 0;
    for (const n of names) {
      const s = similarity(norm, normalize(n));
      if (s > best) { best = s; candidates = [n]; } else if (s === best && s > 0) candidates.push(n);
    }
    if (best < 0.6) return null;
  }
  const score = (n) => {
    const t = tags(n);
    let s = t.filter((x) => fileTags.includes(x)).length * 10;
    const r = REGION_PREF.findIndex((p) => t.includes(p));
    if (r >= 0) s += REGION_PREF.length - r;
    return s - t.length * 0.1;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

function urls(system, name) {
  const base = `${THUMBS}/${encodeURIComponent(system)}`;
  const file = `${encodeURIComponent(name)}.png`;
  return {
    boxart: `${base}/Named_Boxarts/${file}`,
    snap: `${base}/Named_Snaps/${file}`,
    title: `${base}/Named_Titles/${file}`,
  };
}

// Devuelve { fileName: {boxart, snap, title} | null } para todos los juegos de una consola.
// Para "pc" fileNames son las claves de juego y cada campo puede ser una lista de URLs de respaldo.
async function resolveMany(consoleId, fileNames, games = []) {
  if (consoleId === 'pc') return resolvePc(fileNames, games);
  const system = byId[consoleId].libretro;
  const names = await loadIndex(system);
  const out = {};
  for (const f of fileNames) {
    // Sin índice (offline o fallo) se intenta igualmente con el nombre exacto
    const match = names.length ? bestMatch(f, names) : sanitize(f);
    out[f] = match ? urls(system, match) : null;
  }
  return out;
}

// ---------- Juegos de PC ----------

const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const UA = { 'User-Agent': 'GameHub/1.0 (lanzador personal de juegos)' };

// Imágenes que Steam ya guarda en el PC (appcache\librarycache\<appid>\[hash\]fichero)
function steamLocal(appid) {
  const root = pcgames.steamRoot();
  if (!root) return {};
  const dir = path.join(root, 'appcache', 'librarycache', String(appid));
  const found = {};
  const visit = (d, rel, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && depth > 0) visit(path.join(d, e.name), `${rel}${e.name}/`, depth - 1);
      else if (e.isFile() && !found[e.name]) found[e.name] = `gamehub-img://steam/${appid}/${rel}${e.name}`;
    }
  };
  visit(dir, '', 1);
  return found;
}

// Ruta real de una URL gamehub-img:// (solo dentro de la caché de Steam)
function localImagePath(url) {
  const u = new URL(url);
  const root = pcgames.steamRoot();
  if (u.host !== 'steam' || !root) return null;
  const base = path.join(root, 'appcache', 'librarycache');
  const file = path.normalize(path.join(base, decodeURIComponent(u.pathname)));
  return file.startsWith(base + path.sep) && /\.(jpg|png)$/i.test(file) ? file : null;
}

const steamSearch = new Map(); // título -> Promise<{appid, header}|null>
function findSteamApp(title) {
  if (!steamSearch.has(title)) {
    const p = fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`, { headers: UA })
      .then((r) => r.json())
      .then((j) => {
        const norm = normalize(title);
        const item = (j.items || []).find((i) => normalize(i.name) === norm)
          || (j.items || []).find((i) => similarity(norm, normalize(i.name)) >= 0.6);
        return item ? { appid: String(item.id) } : findSteamAppWikidata(title);
      })
      .catch(() => findSteamAppWikidata(title));
    steamSearch.set(title, p);
  }
  return steamSearch.get(title);
}

// Juegos que ya no se venden en Steam (p. ej. Rocket League) no salen en su buscador,
// pero Wikidata guarda su "Steam application ID" (propiedad P1733)
async function findSteamAppWikidata(title) {
  try {
    const api = 'https://www.wikidata.org/w/api.php?format=json';
    const search = await fetch(`${api}&action=wbsearchentities&type=item&language=en&limit=5&search=${encodeURIComponent(title)}`, { headers: UA }).then((r) => r.json());
    const ids = (search.search || []).map((s) => s.id);
    if (!ids.length) return null;
    const data = await fetch(`${api}&action=wbgetentities&props=claims|labels&languages=en&ids=${ids.join('|')}`, { headers: UA }).then((r) => r.json());
    const norm = normalize(title);
    for (const id of ids) {
      const e = data.entities[id];
      const label = e?.labels?.en?.value || '';
      const steamId = e?.claims?.P1733?.[0]?.mainsnak?.datavalue?.value;
      if (steamId && (normalize(label) === norm || similarity(norm, normalize(label)) >= 0.6)) return { appid: String(steamId) };
    }
  } catch { /* sin conexión */ }
  return null;
}

async function resolvePc(keys, games) {
  const out = {};
  await Promise.all(keys.map(async (key) => {
    const g = games.find((x) => x.path === key);
    if (!g) return (out[key] = null);
    const grid = await sgdbImage(g.title, 'grids', 'dimensions=600x900');
    const heroUrl = await hero(g.title);
    let appid = g.appid;
    if (!appid) appid = (await findSteamApp(g.title))?.appid;
    const local = appid && g.source === 'steam' ? steamLocal(appid) : {};
    const cdn = appid ? (f) => `${STEAM_CDN}/${appid}/${f}` : () => null;
    out[key] = {
      boxart: [grid, local['library_600x900.jpg'], local['library_capsule.jpg'], cdn('library_600x900.jpg'), local['header.jpg'], cdn('header.jpg')].filter(Boolean),
      snap: [heroUrl, local['library_hero.jpg'], cdn('library_hero.jpg')].filter(Boolean),
      title: [local['header.jpg'], cdn('header.jpg')].filter(Boolean),
      logo: [local['logo.png'], cdn('logo.png')].filter(Boolean),
    };
  }));
  return out;
}

// ---------- Fotos de consolas (Wikimedia Commons, dominio público) ----------

let photosPromise = null;
function consolePhotos() {
  if (!photosPromise) {
    const withPhoto = CONSOLES.filter((c) => c.photo);
    const titles = withPhoto.map((c) => `File:${c.photo}`).join('|');
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=1600&titles='
      + encodeURIComponent(titles);
    photosPromise = fetch(url, { headers: UA })
      .then((r) => r.json())
      .then((j) => {
        const byFile = {};
        for (const page of Object.values(j.query.pages)) {
          const info = page.imageinfo && page.imageinfo[0];
          if (info) byFile[page.title.replace(/^File:/, '').replace(/ /g, '_')] = info.thumburl || info.url;
        }
        return Object.fromEntries(withPhoto.map((c) => [c.id, byFile[c.photo.replace(/ /g, '_')] || null]));
      })
      .catch(() => {
        photosPromise = null; // reintentar más tarde (sin conexión)
        return {};
      });
  }
  return photosPromise;
}

// ---------- SteamGridDB (opcional, requiere clave gratuita en Ajustes) ----------

const sgdbIds = new Map();
function sgdbGameId(title, key) {
  if (!sgdbIds.has(title)) {
    sgdbIds.set(title, fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`, { headers: { Authorization: `Bearer ${key}` } })
      .then((r) => r.json())
      .then((s) => (s.data && s.data[0] ? s.data[0].id : null))
      .catch(() => null));
  }
  return sgdbIds.get(title);
}

const sgdbCache = new Map();
function sgdbImage(title, kind, query = '') {
  const key = settings.load().steamGridDbKey;
  if (!key) return Promise.resolve(null);
  const cacheKey = `${kind}|${query}|${title}`;
  if (!sgdbCache.has(cacheKey)) {
    sgdbCache.set(cacheKey, sgdbGameId(title, key).then(async (id) => {
      if (!id) return null;
      const r = await fetch(`https://www.steamgriddb.com/api/v2/${kind}/game/${id}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${key}` } }).then((x) => x.json());
      return (r.data && r.data[0] && r.data[0].url) || null;
    }).catch(() => null));
  }
  return sgdbCache.get(cacheKey);
}

// Fondo "hero" de SteamGridDB
function hero(title) {
  return sgdbImage(title, 'heroes');
}

function consoleIcon(consoleId) {
  const system = byId[consoleId].libretro;
  if (!system) return null;
  return `https://raw.githubusercontent.com/libretro/retroarch-assets/master/xmb/monochrome/png/${encodeURIComponent(system)}.png`;
}

module.exports = { resolveMany, hero, consoleIcon, consolePhotos, localImagePath, bestMatch };
