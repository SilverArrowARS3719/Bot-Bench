// Small tween helper. Everything animated in the app goes through here so "reduce motion" is honoured in one place.
export const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };

export const easeOutQuint = t => 1 - (1 - t) ** 5;
export const easeInOutCubic = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutBack = t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

export function tween(ms, step, ease = easeOutQuint) {
  return new Promise(resolve => {
    if (reduceMotion.matches || ms <= 0) {
      step(1);
      return resolve();
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      step(1);
      resolve();
    };
    // Browsers pause animation frames in hidden tabs; the timer makes sure the end state always lands.
    const timer = setTimeout(finish, ms + 100);
    const t0 = performance.now();
    const frame = now => {
      if (done) return;
      const k = Math.min(1, (now - t0) / ms);
      if (k >= 1) { clearTimeout(timer); return finish(); }
      step(ease(k));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
