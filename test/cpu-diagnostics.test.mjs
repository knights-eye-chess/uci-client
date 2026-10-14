import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCpuQuota, parseCpuStat, cpuStatDelta, readCpuSnapshot } from '../src/cpu-diagnostics.mjs';

const stat = (usage = 1000, periods = 10, throttled = 2, throttledUs = 40) =>
  `usage_usec ${usage}\nuser_usec ${usage - 100}\nsystem_usec 100\nnr_periods ${periods}\nnr_throttled ${throttled}\nthrottled_usec ${throttledUs}\n`;

test('CPU diagnostics admit exact finite/unlimited cgroup-v2 quota without unsafe numbers', () => {
  assert.deepEqual(parseCpuQuota('400000 100000\n'), { quotaUs: 400000, periodUs: 100000 });
  assert.deepEqual(parseCpuQuota('max 100000'), { quotaUs: null, periodUs: 100000 });
  for (const source of [null, '', '0 100000', '400000 0', '-1 100000', 'Infinity 100000',
    '9007199254740992 100000', '400000 100000 extra', '400000\u0000100000', 'x'.repeat(129)]) {
    assert.equal(parseCpuQuota(source), null, String(source));
  }
});

test('CPU diagnostics whitelist monotonic counters and reject malformed or reset observations', () => {
  const before = parseCpuStat(stat());
  const after = parseCpuStat(stat(3000, 14, 3, 200) + 'nr_bursts 15\nprivate_host_name secret\n');
  assert.deepEqual(cpuStatDelta(before, after), {
    usageUs: 2000, userUs: 2000, systemUs: 0, nrPeriods: 4, nrThrottled: 1, throttledUs: 160,
  });
  assert.deepEqual(Object.keys(after), ['usageUs', 'userUs', 'systemUs', 'nrPeriods', 'nrThrottled', 'throttledUs']);
  assert.equal(cpuStatDelta(after, before), null, 'Counter reset cannot be reported as negative throttling.');
  assert.equal(cpuStatDelta(null, after), null);
  for (const source of [undefined, '', 'usage_usec 3', stat() + 'usage_usec 3\n',
    stat().replace('nr_throttled 2', 'nr_throttled -1'),
    stat().replace('usage_usec 1000', 'usage_usec 9007199254740992'),
    stat().replace('nr_periods 10', 'nr_periods 10 extra'), 'x'.repeat(4097)]) {
    assert.equal(parseCpuStat(source), null, String(source));
  }
  const partial = parseCpuStat('usage_usec 1000\nnr_periods 10\nnr_throttled 0\nthrottled_usec 0\n');
  assert.equal(partial.userUs, null);
  assert.equal(partial.systemUs, null);
  assert.equal(cpuStatDelta(partial, after).userUs, null);
});

test('CPU snapshots read only fixed controller files and tolerate inaccessible controllers/non-Linux', () => {
  const paths = [];
  const snapshot = readCpuSnapshot({ platform: 'linux', loadAverage: () => [1, 2, 3], readFile(path, encoding) {
    paths.push(path); assert.equal(encoding, 'utf8');
    return path.endsWith('cpu.max') ? '400000 100000' : stat();
  } });
  assert.deepEqual(paths, ['/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu.stat']);
  assert.deepEqual(snapshot.cpuQuota, { quotaUs: 400000, periodUs: 100000 });
  assert.equal(snapshot.cpuStat.nrThrottled, 2);
  assert.deepEqual(snapshot.loadAverage, [1, 2, 3]);
  assert(snapshot.cpuModel === null || (snapshot.cpuModel.length <= 128 && !/[\u0000-\u001f\u007f]/.test(snapshot.cpuModel)));
  const denied = readCpuSnapshot({ platform: 'linux', readFile() { throw Error('/secret/host path'); },
    loadAverage() { throw Error('Unavailable'); } });
  assert.equal(denied.cpuQuota, null);
  assert.equal(denied.cpuStat, null);
  assert.equal(denied.loadAverage, null);
  assert(!JSON.stringify(denied).includes('/secret/host'));
  const elsewhere = readCpuSnapshot({ platform: 'darwin', readFile() { assert.fail('Non-Linux must not read cgroup files.'); },
    loadAverage: () => [1, NaN, -1] });
  assert.equal(elsewhere.cpuQuota, null);
  assert.equal(elsewhere.cpuStat, null);
  assert.equal(elsewhere.loadAverage, null);
});
