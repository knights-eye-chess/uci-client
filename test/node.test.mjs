import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createProcessEngine, stockfishProfile } from '../src/node.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-uci.mjs', import.meta.url));
const request = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  limit: { depth: 4 }, multiPv: 3 };
function host(mode, options = {}) {
  const children = [];
  return { children, engine: createProcessEngine({ command: process.execPath, args: [fixture, mode],
    timeoutMs: 1000, handshakeTimeoutMs: 1000, shutdownGraceMs: 20,
    onSpawn: child => children.push(child), ...options }) };
}

test('cold processes serialize completion and preserve handshake identity', async () => {
  const { engine, children } = host('normal', { spawnProcess(command, args, options) {
    assert(children.every(child => child.exitCode !== null || child.signalCode !== null));
    assert.equal(options.shell, false);
    return spawn(command, args, options);
  } });
  try {
    const results = await Promise.all([engine.search(request), engine.search(request)]);
    assert.equal(children.length, 2);
    assert(children.every(child => child.exitCode === 0));
    assert(results.every(result => result.scoreProvenance.engineBuild === 'Structural fixture 1'));
    assert(results.every(result => result.candidates.length === 3));
  } finally { await engine.close(); }
});

test('warm process reuses one child, records telemetry and rejects overlap', async () => {
  const { engine, children } = host('normal', { reuseProcess: true, threads: 4, hashMb: 128 });
  try {
    const first = engine.search(request);
    await assert.rejects(engine.search(request), /capacity exhausted/);
    const one = await first;
    const two = await engine.search({ ...request, limit: { nodes: 1 }, multiPv: 1 });
    assert.equal(children.length, 1);
    assert.deepEqual([one.diagnostics.processReused, two.diagnostics.processReused], [false, true]);
    assert.equal(two.diagnostics.processInitializationMs, 0);
    assert.equal(one.diagnostics.threads, 4);
    assert.equal(one.diagnostics.hashMb, 128);
    assert.equal(one.diagnostics.nodes, 1366);
    assert.equal(one.diagnostics.hashfull, 237);
    if (process.platform === 'linux') assert(one.diagnostics.processMemory.rssBytes > 0);
    assert.equal(one.candidates[0].nodes, 1366);
    assert.match(one.diagnostics.compiler, /SSE2/);
    assert.deepEqual(two.scoreProvenance.requestedLimit, { nodes: 1 });
  } finally { await engine.close(); }
  assert(children[0].exitCode !== null || children[0].signalCode !== null);
});

test('cancel, timeout, crash and missing executable drain children', async () => {
  for (const mode of ['hang', 'handshake-hang', 'exit']) {
    const { engine, children } = host(mode, { timeoutMs: 80,
      handshakeTimeoutMs: mode === 'handshake-hang' ? 80 : 1000 });
    await assert.rejects(engine.search(request));
    await engine.close();
    assert(children.every(child => child.exitCode !== null || child.signalCode !== null));
  }
  const absent = createProcessEngine({ command: '/definitely/missing/stockfish', handshakeTimeoutMs: 80 });
  await assert.rejects(absent.search(request));
  await absent.close();
  const { engine, children } = host('hang', { reuseProcess: true });
  const controller = new AbortController();
  const active = engine.search({ ...request, signal: controller.signal });
  children.length || await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(active, /cancelled/);
  await engine.close();
  assert(children.every(child => child.exitCode !== null || child.signalCode !== null));
});

test('generic profile validates advertised string/check options without Stockfish assumptions', async () => {
  const profile = { ...stockfishProfile, id: 'generic-fixture', command: process.execPath,
    args: [fixture, 'normal'], compilerCommand: undefined,
    setoptions: { WeightsFile: '/tmp/example.weights', UCI_ShowWDL: true } };
  const engine = createProcessEngine({ profile });
  try {
    const result = await engine.search({ ...request, multiPv: 1 });
    assert.equal(result.diagnostics.threads, null);
    assert.equal(result.diagnostics.hashMb, null);
  } finally { await engine.close(); }
  const invalid = createProcessEngine({ profile: { ...profile, setoptions: { MissingOption: 'x' } } });
  await assert.rejects(invalid.search(request), /does not advertise/);
  await invalid.close();
});

test('missing or out-of-range hashfull remains unavailable', async () => {
  for (const mode of ['no-hashfull', 'invalid-hashfull', 'decimal-hashfull', 'suffix-hashfull', 'string-hashfull', 'mixed-string-hashfull']) {
    const { engine } = host(mode);
    try { assert.equal((await engine.search(request)).diagnostics.hashfull, null); }
    finally { await engine.close(); }
  }
});
