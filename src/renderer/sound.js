// Sonidos de interfaz generados con WebAudio (sin ficheros).
let ctx = null;

function tone(freq, { duration = 0.05, type = 'sine', gain = 0.05, slide = 0, delay = 0 } = {}) {
  if (!sounds.enabled) return;
  ctx = ctx || new AudioContext();
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + duration);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export const sounds = {
  enabled: true,
  move: () => tone(880, { duration: 0.03, gain: 0.025, type: 'triangle' }),
  select: () => { tone(660, { duration: 0.06, type: 'triangle' }); tone(990, { duration: 0.09, type: 'triangle', delay: 0.05 }); },
  back: () => tone(520, { duration: 0.08, type: 'triangle', slide: 0.6 }),
  error: () => tone(180, { duration: 0.15, type: 'square', gain: 0.03 }),
  launch: () => { tone(523, { duration: 0.1 }); tone(784, { duration: 0.12, delay: 0.08 }); tone(1046, { duration: 0.25, delay: 0.16 }); },
};
