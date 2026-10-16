import { readFileSync } from 'node:fs';
/** Linux process snapshot; null means unavailable, never zero memory usage.
 * VmHWM is lifetime peak RSS, not this search's incremental allocation. */
export function readProcessMemory(pid, { platform = process.platform, readFile = readFileSync } = {}) {
  const missing = { rssBytes: null, peakRssBytes: null };
  if (platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 1) return missing;
  try {
    const source = readFile(`/proc/${pid}/status`, 'utf8');
    const bytes = key => {
      const match = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(source);
      const value = match ? Number(match[1]) * 1024 : null;
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    };
    return { rssBytes: bytes('VmRSS'), peakRssBytes: bytes('VmHWM') };
  } catch { return missing; }
}
