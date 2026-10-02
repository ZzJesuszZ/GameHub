// Escaneo de ROMs. library.json guarda solo metadatos (favoritos, última partida),
// nunca imágenes.

const fs = require('fs');
const path = require('path');
const { CONSOLES } = require('./consoles');
const settings = require('./settings');
const pcgames = require('./pcgames');

const metaFile = () => path.join(settings.dataDir(), 'library.json');
let games = {}; // consoleId -> [game]
let meta = null; // romPath -> { favorite, lastPlayed, playCount }

function loadMeta() {
  if (meta) return meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
  } catch {
    meta = {};
  }
  return meta;
}

function saveMeta() {
  fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2));
}

// "Legend of Zelda, The - A Link to the Past (USA) [!]" -> "The Legend of Zelda - A Link to the Past"
function cleanTitle(base) {
  let t = base.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(.*?), (The|A|An|El|La|Los|Las)(\b.*)$/i, '$2 $1$3');
  return t || base;
}

function walk(dir, exts, depth = 2, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) walk(full, exts, depth - 1, out);
    else if (e.isFile() && exts.includes(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

// Ficheros que ya están referenciados por un .m3u/.cue se ocultan para no duplicar
function hideReferenced(files) {
  const referenced = new Set();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext !== '.m3u' && ext !== '.cue') continue;
    try {
      const text = fs.readFileSync(f, 'utf8');
      const refs = ext === '.m3u'
        ? text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
        : [...text.matchAll(/FILE\s+"([^"]+)"/gi)].map((m) => m[1]);
      for (const r of refs) referenced.add(path.resolve(path.dirname(f), r).toLowerCase());
    } catch { /* fichero ilegible: se ignora */ }
  }
  return files.filter((f) => !referenced.has(f.toLowerCase()));
}

function scan() {
  const root = settings.load().romsDir;
  loadMeta();
  games = {};
  for (const c of CONSOLES) {
    if (c.pc) {
      games.pc = scanPc();
      continue;
    }
    const dir = path.join(root, c.id);
    fs.mkdirSync(dir, { recursive: true });
    const files = hideReferenced(walk(dir, c.exts));
    games[c.id] = files
      .map((file) => {
        const base = path.basename(file, path.extname(file));
        const m = meta[file] || {};
        return {
          path: file, console: c.id, fileName: base, title: cleanTitle(base),
          favorite: !!m.favorite, lastPlayed: m.lastPlayed || 0, playCount: m.playCount || 0,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
  }
  return counts();
}

function scanPc() {
  let found = [];
  try {
    found = pcgames.scan();
  } catch (err) {
    console.error('Error buscando juegos de PC:', err.message);
  }
  return found
    .map((g) => {
      const m = meta[g.key] || {};
      return {
        ...g, path: g.key, console: 'pc', fileName: g.key,
        favorite: !!m.favorite, lastPlayed: m.lastPlayed || 0, playCount: m.playCount || 0,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
}

function counts() {
  return Object.fromEntries(Object.entries(games).map(([id, list]) => [id, list.length]));
}

function list(consoleId) {
  return games[consoleId] || [];
}

function find(romPath) {
  for (const l of Object.values(games)) {
    const g = l.find((x) => x.path === romPath);
    if (g) return g;
  }
  return null;
}

function update(romPath, patch) {
  loadMeta();
  meta[romPath] = { ...(meta[romPath] || {}), ...patch };
  saveMeta();
  const g = find(romPath);
  if (g) Object.assign(g, patch);
  return g;
}

function recent(limit = 12) {
  return Object.values(games).flat()
    .filter((g) => g.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, limit);
}

module.exports = { scan, counts, list, find, update, recent };
