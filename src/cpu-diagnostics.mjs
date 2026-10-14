import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';

const statKeys = {
  usage_usec: 'usageUs', user_usec: 'userUs', system_usec: 'systemUs',
  nr_periods: 'nrPeriods', nr_throttled: 'nrThrottled', throttled_usec: 'throttledUs',
};
const counter = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const safeRead = operation => { try { return operation(); } catch { return null; } };

export function parseCpuQuota(source) {
  if (typeof source !== 'string' || source.length > 128) return null;
  const parts = source.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const quotaUs = parts[0] === 'max' ? null : counter(parts[0]);
  const periodUs = counter(parts[1]);
  if (periodUs === null || periodUs === 0 || (parts[0] !== 'max' && (quotaUs === null || quotaUs === 0))) return null;
  return { quotaUs, periodUs };
}

export function parseCpuStat(source) {
  if (typeof source !== 'string' || source.length > 4096) return null;
  const result = Object.fromEntries(Object.values(statKeys).map(key => [key, null]));
  const seen = new Set();
  for (const line of source.trim().split('\n')) {
    const [key, value, extra] = line.trim().split(/\s+/);
    if (!Object.hasOwn(statKeys, key)) continue;
    const parsed = value === undefined ? null : counter(value);
    if (seen.has(key) || extra !== undefined || parsed === null) return null;
    seen.add(key);
    result[statKeys[key]] = parsed;
  }
  // These counters are present together on supported cgroup-v2 CPU controllers.
  // Missing optional user/system counters remain null rather than invented zeroes.
  if (['usageUs', 'nrPeriods', 'nrThrottled', 'throttledUs'].some(key => result[key] === null)) return null;
  return result;
}

export function cpuStatDelta(before, after) {
  if (!before || !after) return null;
  const result = {};
  for (const key of Object.values(statKeys)) {
    const left = before[key], right = after[key];
    if (left === null || right === null) { result[key] = null; continue; }
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < left) return null;
    result[key] = right - left;
  }
  return result;
}

const cpuModel = safeRead(() => {
  const model = cpus()[0]?.model;
  return typeof model === 'string' ? model.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128) || null : null;
});

/** Optional fixed-path Linux observations. Never emit paths, environment values,
 * hostnames, arbitrary cpu.stat fields or filesystem errors. Load averages are
 * host-wide; cgroup counters include every process in this container. */
export function readCpuSnapshot({ readFile = readFileSync, loadAverage = loadavg,
  platform = process.platform } = {}) {
  const loads = safeRead(loadAverage);
  const loadAverageValues = Array.isArray(loads) && loads.length === 3 &&
    loads.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9)
    ? [...loads] : null;
  const read = path => platform === 'linux' ? safeRead(() => readFile(path, 'utf8')) : null;
  return {
    cpuModel,
    loadAverage: loadAverageValues,
    cpuQuota: parseCpuQuota(read('/sys/fs/cgroup/cpu.max')),
    cpuStat: parseCpuStat(read('/sys/fs/cgroup/cpu.stat')),
  };
}
