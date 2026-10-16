import test from 'node:test';
import assert from 'node:assert/strict';
import { readProcessMemory } from '../src/process-memory.mjs';
test('memory telemetry names engine process and reports lifetime peak separately', () => {
  assert.deepEqual(readProcessMemory(42, { platform: 'linux', readFile(path) { assert.equal(path, '/proc/42/status'); return 'VmRSS:\t123 kB\nVmHWM:\t456 kB\n'; } }), { rssBytes: 125952, peakRssBytes: 466944 });
});
test('missing, malformed, overflowing or unsupported memory telemetry is null', () => {
  for (const source of ['', 'VmRSS: -1 kB', 'VmRSS: 999999999999999999999 kB']) assert.deepEqual(readProcessMemory(1, { platform: 'linux', readFile: () => source }), { rssBytes: null, peakRssBytes: null });
  assert.deepEqual(readProcessMemory(1, { platform: 'darwin', readFile: () => { throw Error('must not read'); } }), { rssBytes: null, peakRssBytes: null });
});
