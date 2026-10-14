import test from 'node:test';
import assert from 'node:assert/strict';
import { createUciClient } from '../src/index.mjs';
import { stockfishProfile } from '../src/node.mjs';

const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const profile = { ...stockfishProfile, id: 'test', command: 'fixture', args: [],
  engineBuild: 'test-build', weightsId: 'test-weights' };
function harness(request = { fen, limit: { depth: 8 }, multiPv: 1 }, selected = profile) {
  const commands = [];
  let receive, terminated = 0;
  const client = createUciClient((_label, onData) => {
    receive = onData;
    return { postMessage: command => commands.push(command), terminate: () => { terminated++; } };
  }, { profile: selected, timeoutMs: 1000 });
  const pending = client.search(request);
  for (const line of ['frame-ready', 'uciok', 'readyok']) receive(line);
  return { pending, receive, commands, get terminated() { return terminated; } };
}

test('complete scored roots preserve depth, score, identity and explicit coverage', async () => {
  const h = harness({ fen, limit: { depth: 8 }, multiPv: 2, rootMoves: ['e2e4', 'd2d4'], requireRootCoverage: true });
  h.receive('info depth 8 multipv 1 score cp 0 wdl 400 300 300 pv e2e4 e7e5');
  h.receive('info depth 9 multipv 2 score mate -3 pv d2d4 d7d5');
  h.receive('bestmove e2e4 ponder e7e5');
  const result = await h.pending;
  assert.equal(result.depth, 8);
  assert.deepEqual(result.candidates.map(line => [line.scoreCp, line.mate]), [[0, null], [null, -3]]);
  assert.deepEqual(result.candidates[0].wdl, { win: 400, draw: 300, loss: 300 });
  assert.deepEqual(result.scoreProvenance, { kind: 'root-search', fen,
    originatingDepth: 8, reportedDepth: 8, engineBuild: 'test-build', weightsId: 'test-weights',
    requestedLimit: { depth: 8 } });
  assert(h.commands.includes('go depth 8 searchmoves e2e4 d2d4'));
  assert.equal(h.terminated, 1);
});

test('unrestricted MultiPV is an upper bound and nodes keep actual achieved depth', async () => {
  const h = harness({ fen, limit: { nodes: 1 }, multiPv: 3 });
  h.receive('info depth 1 multipv 1 score cp 0 pv e2e4');
  h.receive('info depth 1 multipv 2 score cp 0 pv d2d4');
  h.receive('bestmove e2e4');
  const result = await h.pending;
  assert.equal(result.candidates.length, 2);
  assert.equal(result.depth, 1);
  assert.equal(result.scoreProvenance.originatingDepth, 1);
  assert.equal(result.scoreProvenance.reportedDepth, 1);
  assert.deepEqual(result.scoreProvenance.requestedLimit, { nodes: 1 });
  assert(h.commands.includes('go nodes 1'));
});

test('incomplete scores, PVs and explicit roots reject', async () => {
  for (const info of [
    'info depth 8 score cp 1 lowerbound pv e2e4',
    'info depth 8 score cp 1 score mate 2 pv e2e4',
    'info depth 8 score cp NaN pv e2e4',
    'info depth 8 score cp 1 pv e2e9',
    'info depth 7 score cp 1 pv e2e4',
  ]) {
    const h = harness(); h.receive(info); h.receive('bestmove e2e4');
    await assert.rejects(h.pending, /did not complete/);
    assert.equal(h.terminated, 1);
  }
  const h = harness({ fen, limit: { depth: 8 }, multiPv: 2, rootMoves: ['e2e4', 'd2d4'], requireRootCoverage: true });
  h.receive('info depth 8 multipv 1 score cp 1 pv e2e4');
  h.receive('bestmove e2e4');
  await assert.rejects(h.pending, /root coverage/);
});

test('exclusive limits, capabilities, cancellation and synchronous transport errors', async () => {
  let acquired = 0;
  const client = createUciClient(() => { acquired++; throw Error('acquired'); }, { profile });
  for (const limit of [{ depth: 1, nodes: 1 }, {}, { nodes: 0 }])
    await assert.rejects(client.search({ fen, limit }), /Invalid or unsupported/);
  const restricted = { ...profile, capabilities: { ...profile.capabilities, nodes: false } };
  await assert.rejects(createUciClient(() => { acquired++; }, { profile: restricted })
    .search({ fen, limit: { nodes: 1 } }), /unsupported/);
  assert.equal(acquired, 0);
  const controller = new AbortController();
  const h = harness({ fen, limit: { depth: 8 }, signal: controller.signal });
  controller.abort();
  await assert.rejects(h.pending, /cancelled/);
  assert.equal(h.terminated, 1);
  let terminated = 0;
  const sync = createUciClient((_label, onData) => {
    onData('engineerror unavailable');
    return { postMessage() {}, terminate() { terminated++; } };
  }, { profile });
  await assert.rejects(sync.search({ fen, limit: { depth: 8 } }), /unavailable/);
  assert.equal(terminated, 1);
});

test('optional move statistics require an explicit profile parser', async () => {
  const selected = { ...profile, capabilities: { ...profile.capabilities, moveStats: true },
    parseMoveStats: line => line === 'info string prior e2e4 0.75'
      ? { move: 'e2e4', prior: 0.75 } : null };
  const h = harness(undefined, selected);
  h.receive('info string prior e2e4 0.75');
  h.receive('info depth 8 score cp 10 pv e2e4');
  h.receive('bestmove e2e4');
  assert.deepEqual((await h.pending).moveStats, { e2e4: { prior: 0.75 } });
});

test('classifier adapter regression: malformed scores and PVs never complete', async () => {
  for (const score of ['', 'score cp NaN', 'score cp 1.5',
    'score cp 12 score mate 2', 'score cp 12 lowerbound']) {
    const h = harness();
    h.receive(`info depth 8 multipv 1 ${score} pv e2e4 e7e5`);
    h.receive('bestmove e2e4');
    await assert.rejects(h.pending, /did not complete/);
    assert.equal(h.terminated, 1);
  }
  for (const pv of ['', 'none', 'e2e4 e7e9', 'e2e4 e7e5q']) {
    const h = harness();
    h.receive(`info depth 8 multipv 1 score cp 12 pv ${pv}`);
    h.receive('bestmove e2e4');
    await assert.rejects(h.pending, /did not complete/);
    assert.equal(h.terminated, 1);
  }
});

test('classifier adapter regression: shallow, duplicate, foreign root and mismatched bestmove reject', async () => {
  for (const lines of [
    ['info depth 7 multipv 1 score cp 12 pv e2e4', 'bestmove e2e4'],
    ['info depth 8 multipv 1 score cp 12 pv e2e4', 'bestmove e2e4'],
    ['info depth 8 multipv 1 score cp 12 pv e2e4', 'info depth 8 multipv 2 score cp 10 pv e2e4', 'bestmove e2e4'],
    ['info depth 8 multipv 1 score cp 12 pv e2e4', 'info depth 8 multipv 2 score cp 10 pv g1f3', 'bestmove e2e4'],
    ['info depth 8 multipv 1 score cp 12 pv e2e4', 'info depth 8 multipv 2 score cp 10 pv d2d4', 'bestmove d2d4'],
  ]) {
    const single = lines.length === 2 && lines[0].includes('depth 7');
    const h = harness({ fen, limit: { depth: 8 }, multiPv: single ? 1 : 2,
      rootMoves: single ? [] : ['e2e4', 'd2d4'], requireRootCoverage: !single });
    for (const line of lines) h.receive(line);
    await assert.rejects(h.pending, /did not complete/);
    assert.equal(h.terminated, 1);
  }
});

test('classifier adapter regression: invalid root counts and duplicates never acquire', async () => {
  let acquired = 0;
  const client = createUciClient(() => { acquired++; throw Error('should not acquire'); }, { profile });
  for (const request of [
    { fen, limit: { depth: 0 } }, { fen, limit: { depth: 8 }, multiPv: 0 },
    { fen, limit: { depth: 8 }, multiPv: 2, rootMoves: ['e2e4', 'd2d4', 'g1f3'], requireRootCoverage: true },
    { fen, limit: { depth: 8 }, multiPv: 2, rootMoves: ['e2e4', 'e2e4'] },
  ]) await assert.rejects(client.search(request), /Invalid or unsupported/);
  assert.equal(acquired, 0);
});

test('classifier adapter regression: actual two-reply position accepts one or two unrestricted MultiPV3 lines', async () => {
  const twoReplyFen = '7r/p1p1p1kp/2p2rpQ/3q4/3P4/2P5/P1P2PP1/R3K2R b KQ - 5 18';
  function completed({ multiPv = 3, rootMoves = [], lines = ['g7g8', 'g7f7'], depth = 18 } = {}) {
    const h = harness({ fen: twoReplyFen, limit: { depth: 18 }, multiPv, rootMoves,
      requireRootCoverage: rootMoves.length > 0 });
    for (const [i, move] of lines.entries())
      h.receive(`info depth ${depth} multipv ${i + 1} score cp ${20 - i * 10} pv ${move}`);
    h.receive('bestmove g7g8');
    return h.pending;
  }
  for (const lines of [['g7g8', 'g7f7'], ['g7g8']]) {
    const result = await completed({ lines });
    assert.deepEqual(result.candidates.map(line => line.pv[0]), lines);
    assert.equal(result.depth, 18);
  }
  for (const args of [{ lines: [] }, { depth: 17 }, { lines: ['g7g8', 'g7g8'] },
    { multiPv: 2, rootMoves: ['g7g8', 'g7f7'], lines: ['g7g8'] }])
    await assert.rejects(completed(args), /coverage/);
});

test('explicit no-move has profile identity and no invented scored candidate', async () => {
  const h = harness({ fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', limit: { depth: 4 } });
  h.receive('info depth 0 score mate 0');
  h.receive('bestmove (none)');
  assert.deepEqual(await h.pending, { noMove: true, bestmove: null, candidates: [],
    engineBuild: 'test-build', weightsId: 'test-weights' });
  const malformed = harness();
  malformed.receive('info depth 8 score cp 20 pv e2e4');
  malformed.receive('bestmove (none)');
  await assert.rejects(malformed.pending, /did not complete/);
});

test('restricted roots are a search set; full coverage is opt-in', async () => {
  const h = harness({ fen, limit: { depth: 8 }, multiPv: 1, rootMoves: ['e2e4', 'd2d4'] });
  h.receive('info depth 8 multipv 1 score cp 20 pv e2e4');
  h.receive('bestmove e2e4');
  assert.deepEqual((await h.pending).candidates.map(line => line.pv[0]), ['e2e4']);
  assert(h.commands.includes('go depth 8 searchmoves e2e4 d2d4'));
  const short = harness({ fen, limit: { depth: 8 }, multiPv: 2, rootMoves: ['e2e4', 'd2d4'] });
  short.receive('info depth 8 multipv 1 score cp 20 pv e2e4');
  short.receive('bestmove e2e4');
  assert.equal((await short.pending).candidates.length, 1);
  const foreign = harness({ fen, limit: { depth: 8 }, multiPv: 1, rootMoves: ['e2e4', 'd2d4'] });
  foreign.receive('info depth 8 score cp 20 pv g1f3');
  foreign.receive('bestmove g1f3');
  await assert.rejects(foreign.pending, /root coverage/);
});

test('nodes and time searches retain achieved depth zero without weakening depth limits', async () => {
  for (const limit of [{ nodes: 1 }, { movetime: 1 }]) {
    const h = harness({ fen, limit });
    h.receive('info depth 0 score cp 0 pv e2e4');
    h.receive('bestmove e2e4');
    const result = await h.pending;
    assert.equal(result.depth, 0);
    assert.equal(result.scoreProvenance.originatingDepth, 0);
  }
  const depth = harness({ fen, limit: { depth: 1 } });
  depth.receive('info depth 0 score cp 0 pv e2e4');
  depth.receive('bestmove e2e4');
  await assert.rejects(depth.pending, /did not complete/);
});
