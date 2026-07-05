// Trailing-edge debounce: coalesce a burst of calls into a single invocation
// that runs once `wait` ms have passed since the most recent call. The returned
// function exposes `.cancel()` to drop any pending invocation (used on React
// effect cleanup so a queued call can't fire after unmount).
export function debounce(fn, wait) {
  let timer = null;

  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
