// Recorta el fondo blanco de las fotos de consola (estilo "producto sobre blanco")
// rellenando desde los bordes. El resultado es un blob en memoria; nada se guarda en disco.

const cache = new Map(); // url -> Promise<blobUrl>

// Fondo: casi blanco y poco saturado, o ya transparente
function isBackground(d, i) {
  if (d[i + 3] < 24) return true;
  const r = d[i], g = d[i + 1], b = d[i + 2];
  return r > 222 && g > 222 && b > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
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
