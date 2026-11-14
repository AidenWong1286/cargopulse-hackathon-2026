/**
 * Optional interface sounds, synthesised with Web Audio (no audio files, CSP-safe).
 * Silent unless the user turned sound on (html[data-sound="on"]).
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (document.documentElement.dataset.sound !== "on") return null;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, length: number, gain: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  amp.gain.setValueAtTime(0, ctx.currentTime + start);
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.05);
}

/** A gentle two-note bell, for approvals and success moments. */
export function playChime() {
  const ctx = audio();
  if (!ctx) return;
  tone(ctx, 1046.5, 0, 1.4, 0.07);
  tone(ctx, 1567.98, 0.09, 1.6, 0.05);
  tone(ctx, 2093, 0.09, 0.9, 0.015, "triangle");
}

/** A soft filtered-noise whoosh, for page transitions. */
export function playWhoosh() {
  const ctx = audio();
  if (!ctx) return;
  const length = 0.55;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(300, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(2200, ctx.currentTime + length * 0.6);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, ctx.currentTime);
  amp.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.12);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
  source.connect(filter).connect(amp).connect(ctx.destination);
  source.start();
}

/** A tiny click, for snapping / stamping moments. */
export function playTick(pitch = 1) {
  const ctx = audio();
  if (!ctx) return;
  tone(ctx, 2400 * pitch, 0, 0.06, 0.03, "triangle");
}

/** A low, soft thud for a stamp or a heavy object landing. */
export function playThud() {
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.frequency.setValueAtTime(140, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.25);
  amp.gain.setValueAtTime(0.12, ctx.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
  osc.connect(amp).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.35);
}
