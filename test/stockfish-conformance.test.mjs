import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessEngine } from '../src/node.mjs';

// Set STOCKFISH_18_JS and/or STOCKFISH_19_JS to installed single-thread JS
// launchers. These are real Stockfish engines, not the structural fixture.
const profiles = [18, 19].flatMap(version => process.env[`STOCKFISH_${version}_JS`]
  ? [{ version, launcher: process.env[`STOCKFISH_${version}_JS`] }] : []);
if (profiles.length === 0) test.skip('real Stockfish profiles require STOCKFISH_18_JS or STOCKFISH_19_JS');
const twoReplies = '8/7p/8/8/8/2k5/8/K7 w - - 0 1';
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

for (const { version, launcher } of profiles) {
  const options = { command: process.execPath, args: [launcher], timeoutMs: 60000,
    handshakeTimeoutMs: 20000, shutdownGraceMs: 500 };
  test(`Stockfish ${version}: real finite MultiPV3 with only two legal replies`, async () => {
    const engine = createProcessEngine(options);
    try {
      const result = await engine.search({ fen: twoReplies, limit: { depth: 4 }, multiPv: 3 });
      assert.equal(result.candidates.length, 2);
      assert.deepEqual(new Set(result.candidates.map(line => line.pv[0])), new Set(['a1a2', 'a1b1']));
      assert(result.candidates.every(line => line.depth >= 4));
      assert.equal(result.candidates[0].pv[0], result.bestmove);
      assert.match(result.scoreProvenance.engineBuild, /Stockfish/i);
    } finally { await engine.close(); }
  });

  test(`Stockfish ${version}: checkmate reports no move; restricted subset may return one best root`, async () => {
    const engine = createProcessEngine(options);
    try {
      const noMove = await engine.search({ fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
        limit: { depth: 4 } });
      assert.equal(noMove.noMove, true);
      assert.equal(noMove.bestmove, null);
      assert.deepEqual(noMove.candidates, []);
      assert.match(noMove.engineBuild, /Stockfish/i);
      const subset = await engine.search({ fen: start, limit: { depth: 3 },
        multiPv: 1, rootMoves: ['e2e4', 'd2d4'] });
      assert.equal(subset.noMove, false);
      assert.equal(subset.candidates.length, 1);
      assert(['e2e4', 'd2d4'].includes(subset.bestmove));
    } finally { await engine.close(); }
  });

  test(`Stockfish ${version}: warm depth/nodes/movetime, explicit roots and provenance`, async () => {
    const engine = createProcessEngine({ ...options, reuseProcess: true });
    try {
      const first = await engine.search({ fen: start, limit: { depth: 4 }, multiPv: 2 });
      const roots = first.candidates.map(line => line.pv[0]);
      const second = await engine.search({ fen: start, limit: { depth: 4 }, multiPv: 2, rootMoves: roots });
      const nodes = await engine.search({ fen: start, limit: { nodes: 1000 } });
      const time = await engine.search({ fen: start, limit: { movetime: 100 } });
      assert.equal(first.diagnostics.processReused, false);
      assert([second, nodes, time].every(result => result.diagnostics.processReused));
      assert.deepEqual(new Set(second.candidates.map(line => line.pv[0])), new Set(roots));
      assert(second.candidates.every(line => line.depth >= 4));
      assert.deepEqual(nodes.scoreProvenance.requestedLimit, { nodes: 1000 });
      assert.deepEqual(time.scoreProvenance.requestedLimit, { movetime: 100 });
      assert(nodes.depth > 0 && time.depth > 0);
    } finally { await engine.close(); }
  });

  test(`Stockfish ${version}: cancellation, timeout and crash drain the real child`, async () => {
    for (const failure of ['cancel', 'timeout', 'crash']) {
      let child;
      const controller = new AbortController();
      const engine = createProcessEngine({ ...options, timeoutMs: failure === 'timeout' ? 1 : 5000,
        onSpawn(spawned) {
          child = spawned;
          if (failure !== 'timeout') spawned.stdout.on('data', data => {
            if (!String(data).includes('info depth ')) return;
            if (failure === 'cancel') controller.abort();
            else spawned.kill('SIGKILL');
          });
        } });
      try {
        await assert.rejects(engine.search({ fen: start, limit: { depth: 99 },
          signal: controller.signal }), failure === 'cancel' ? /cancelled/ : undefined);
        assert(child.exitCode !== null || child.signalCode !== null);
      } finally { await engine.close(); }
    }
  });
}
