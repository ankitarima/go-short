// Shared helpers. The fixture rules mirror load/seed.sql: slug 'k' + zero-padded index, every 100th
// link disabled, every 200th+1 expired, everything else an active redirect.
export const slugOf = (i) => 'k' + String(i).padStart(6, '0');

export function expectedStatus(i) {
  if (i % 100 === 0) return 410; // disabled
  if (i % 200 === 1) return 410; // expired
  return 302;
}

export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const env = (name, fallback) =>
  __ENV[name] !== undefined && __ENV[name] !== '' ? __ENV[name] : fallback;

/** "90s" / "10m" / "1h" -> seconds. */
export function seconds(duration) {
  const m = /^(\d+)(s|m|h)$/.exec(duration);
  if (!m) throw new Error(`bad duration ${duration}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}

/**
 * Allowed number of dropped iterations: 0.1% of the planned requests (min 1). k6 can drop one or two
 * at the very start while virtual users warm up; a real shortfall (the generator or the server could
 * not keep the arrival rate) is far above that and still fails the run.
 */
export const droppedBudget = (rate, duration) =>
  Math.max(1, Math.ceil(rate * seconds(duration) * 0.001));
