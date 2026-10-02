// Recorta el fondo blanco de las fotos de consola (estilo "producto sobre blanco")
// rellenando desde los bordes. El resultado es un blob en memoria; nada se guarda en disco.
//
// Algunas fotos de Wikimedia (p. ej. Wii, GameCube, PSP) ya vienen recortadas de origen,
// con su propio canal alfa. Si se les aplica el mismo relleno por color, las zonas claras
// de la propia consola (blancos, brillos) se confunden con fondo y quedan con agujeros.
// Por eso primero se comprueba si la imagen ya trae transparencia real en el borde: si es
// así, se usa tal cual y no se toca nada.

const cache = new Map(); // url -> Promise<blobUrl>

// Fondo: casi blanco y poco saturado (fondo de estudio); el ya transparente se trata aparte.
// Se usa para arrancar el relleno desde el borde (evita comerse sin querer una consola clara
// que tocase el marco).
function isBackgroundStrict(d, i) {
  if (d[i + 3] < 24) return true;
  const r = d[i], g = d[i + 1], b = d[i + 2];
  return r > 222 && g > 222 && b > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
}

// ¿Es prácticamente el mismo color que el fondo real de ESTA foto? A diferencia de
// isBackgroundStrict (un umbral fijo de "blanco"), compara contra el color de fondo medido,
// que puede ser gris claro o tener un ligero tinte. Solo con esto se detectan, aparte, los
// huecos de fondo que quedan encerrados (p. ej. dentro del lazo de un cable) y que el relleno
// desde el borde nunca llega a tocar porque el canal que los conecta es demasiado estrecho.
function isNearColor(d, i, bg, maxDist) {
  if (d[i + 3] < 24) return true;
  const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
  return dr * dr + dg * dg + db * db < maxDist * maxDist;
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
    if (!removed[p] && isBackgroundStrict(d, p * 4)) {
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

  // Color medio real del fondo de esta foto (puede no ser blanco puro)
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
  for (let p = 0; p < w * h; p += 7) {
    if (removed[p]) {
      const i = p * 4;
      bgR += d[i]; bgG += d[i + 1]; bgB += d[i + 2]; bgCount++;
    }
  }
  const bg = bgCount ? [bgR / bgCount, bgG / bgCount, bgB / bgCount] : [255, 255, 255];

  // Huecos de fondo encerrados (p. ej. dentro del lazo de un cable) que el relleno desde el
  // borde nunca alcanza porque el canal que los conecta es demasiado estrecho o borroso. Se
  // buscan regiones que no toquen el borde de la imagen y cuyo color sea casi idéntico al
  // fondo real (no solo "claro": el ruido de compresión JPEG puede aclarar algún bloque de
  // una superficie clara sin que sea en realidad un hueco, por eso se exige un tamaño mínimo
  // bastante generoso además de un color muy parecido al fondo).
  const visited = new Uint8Array(w * h);
  const compStack = new Int32Array(w * h);
  const comp = new Int32Array(w * h);
  const maxHoleArea = w * h * 0.015;
  const minHoleArea = Math.max(250, w * h * 0.0003);
  const holeDist = 22;
  for (let p = 0; p < w * h; p++) {
    if (removed[p] || visited[p]) continue;
    if (!isNearColor(d, p * 4, bg, holeDist)) {
      visited[p] = 1;
      continue;
    }
    let top2 = 0, size = 0, touchesBorder = false;
    compStack[top2++] = p;
    visited[p] = 1;
    while (top2) {
      const q = compStack[--top2];
      comp[size++] = q;
      const x = q % w;
      if (x === 0 || x === w - 1 || q < w || q >= w * (h - 1)) touchesBorder = true;
      if (x > 0 && !visited[q - 1] && !removed[q - 1] && isNearColor(d, (q - 1) * 4, bg, holeDist)) { visited[q - 1] = 1; compStack[top2++] = q - 1; }
      if (x < w - 1 && !visited[q + 1] && !removed[q + 1] && isNearColor(d, (q + 1) * 4, bg, holeDist)) { visited[q + 1] = 1; compStack[top2++] = q + 1; }
      if (q >= w && !visited[q - w] && !removed[q - w] && isNearColor(d, (q - w) * 4, bg, holeDist)) { visited[q - w] = 1; compStack[top2++] = q - w; }
      if (q < w * (h - 1) && !visited[q + w] && !removed[q + w] && isNearColor(d, (q + w) * 4, bg, holeDist)) { visited[q + w] = 1; compStack[top2++] = q + w; }
      if (size >= maxHoleArea && !touchesBorder) break; // ya es demasiado grande para ser un hueco: no es fondo encerrado
    }
    if (!touchesBorder && size >= minHoleArea && size < maxHoleArea) {
      for (let k = 0; k < size; k++) removed[comp[k]] = 1;
    }
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
