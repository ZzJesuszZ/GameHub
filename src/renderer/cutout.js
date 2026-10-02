// Recorta el fondo blanco de las fotos de consola (estilo "producto sobre blanco")
// rellenando desde los bordes. El resultado es un blob en memoria; nada se guarda en disco.
//
// Algunas fotos de Wikimedia (p. ej. Wii, GameCube, PSP) ya vienen recortadas de origen,
// con su propio canal alfa. Si se les aplica el mismo relleno por color, las zonas claras
// de la propia consola (blancos, brillos) se confunden con fondo y quedan con agujeros.
// Por eso primero se comprueba si la imagen ya trae transparencia real en el borde: si es
// así, se usa tal cual y no se toca nada.

const cache = new Map(); // url -> Promise<blobUrl>

// Fondo: casi blanco y poco saturado (fondo de estudio); el ya transparente se trata aparte
function isBackground(d, i) {
  if (d[i + 3] < 24) return true;
  const r = d[i], g = d[i + 1], b = d[i + 2];
  return r > 222 && g > 222 && b > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
}

// ¿El borde de la imagen ya es transparente? Indica una foto ya recortada en origen.
function alreadyCutOut(d, w, h) {
  let transparent = 0, sampled = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 120));
  for (let x = 0; x < w; x += step) {
    sampled += 2;
    if (d[(x) * 4 + 3] < 10) transparent++;
    if (d[((h - 1) * w + x) * 4 + 3] < 10) transparent++;
  }
  for (let y = 0; y < h; y += step) {
    sampled += 2;
    if (d[(y * w) * 4 + 3] < 10) transparent++;
    if (d[(y * w + w - 1) * 4 + 3] < 10) transparent++;
  }
  return sampled > 0 && transparent / sampled > 0.05;
}

async function process(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;

  if (alreadyCutOut(d, w, h)) return url;

  // Relleno por inundación desde todos los píxeles del borde
  const removed = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (p) => {
    if (!removed[p] && isBackground(d, p * 4)) {
      removed[p] = 1;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }

  // Quitar el fondo y suavizar el borde (píxeles claros junto al fondo, semitransparentes)
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (removed[p]) {
      d[i + 3] = 0;
      continue;
    }
    const x = p % w;
    const nearBg = (x > 0 && removed[p - 1]) || (x < w - 1 && removed[p + 1])
      || (p >= w && removed[p - w]) || (p < w * (h - 1) && removed[p + w]);
    if (nearBg) {
      const light = (d[i] + d[i + 1] + d[i + 2]) / 3;
      d[i + 3] = Math.min(d[i + 3], Math.max(60, 255 - Math.max(0, light - 150) * 2));
    }
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

export function cutout(url) {
  if (!cache.has(url)) {
    const p = process(url);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}
