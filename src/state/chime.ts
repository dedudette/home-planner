let ctx: AudioContext | null = null;

/** Soft two-note chime. `silent` only unlocks audio (must be called from a user gesture). */
export const playChime = (silent = false): void => {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    if (silent) return;
    const now = ctx.currentTime;
    [523.25, 783.99].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.22 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.9);
      o.connect(g).connect(ctx!.destination);
      o.start(now + i * 0.22);
      o.stop(now + i * 0.22 + 1);
    });
  } catch { /* audio is a nicety */ }
};
