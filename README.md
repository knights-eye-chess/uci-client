# UCI Client

`@knights-eye-chess/uci-client` runs finite UCI searches. Its root export is a
transport-neutral protocol client. The `/node` export owns child processes,
sequential warm reuse, shutdown, and CPU diagnostics. Neither export depends on
classification, AI, PGN tools, or an engine binary.

This local preview extracts MIT code from `move-classifier`'s Stockfish adapter
and `pgn-annotator`'s process engine and CPU diagnostics. The package is not
published. Engine executables and model weights have their own licenses and are
supplied separately.

```js
import { createProcessEngine } from '@knights-eye-chess/uci-client/node';

const engine = createProcessEngine({ command: 'stockfish', reuseProcess: true });
try {
  const result = await engine.search({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    limit: { depth: 12 }, multiPv: 3,
  });
  console.log(result.bestmove, result.candidates);
} finally {
  await engine.close();
}
```

Exactly one positive limit is required: `{ depth: n }`, `{ nodes: n }`, or
`{ movetime: ms }`. A profile names the executable and argv, UCI options, and
supported capabilities. The default Node profile is Stockfish with one thread
and 16 MiB of hash. For another UCI engine, supply `profile` explicitly:

```js
const profile = {
  id: 'my-uci-engine', command: '/path/to/engine', args: [],
  setoptions: { WeightsFile: '/path/to/weights', UCI_ShowWDL: true },
  weightsId: 'weights-sha-or-version',
  capabilities: { depth: true, nodes: true, movetime: true, multiPv: true,
    searchmoves: true, wdl: true, moveStats: false },
};
```

The Node host checks configured options against the engine's advertised UCI
options. Unsupported request capabilities fail explicitly. `multiPv` is an
upper bound for an unrestricted search: a position with two legal replies can
complete a MultiPV3 request with two scored candidates. Explicit `rootMoves`
still require every requested root. Completed lines retain actual achieved
depth. `originatingDepth` and `reportedDepth` are the depths reported on the
scored `info` line, including nodes and movetime searches; neither is filled
from the requested limit. `scoreProvenance` also records the limit, engine build, and
optional weights identity. Centipawn scores are engine-specific and should not
be mixed across differently calibrated engines. `wdl` is optional. `moveStats`
requires a profile-specific parser; no Lc0 output format is assumed here.

An explicit `bestmove (none)` with no scored roots returns `noMove: true`,
`bestmove: null`, empty `candidates`, and top-level engine identity. This is a
UCI no-move report, not proof of a legal terminal position; the host must check
the board before calling it checkmate, stalemate, or draw. Scored results have
`noMove: false` and the same top-level identity. For restricted `rootMoves`,
`multiPv` limits the number of reported candidates and fewer lines may complete.
Set `requireRootCoverage: true` when a comparison requires every named root;
that request is rejected if more roots are named than `multiPv` permits.

The root client takes an `acquire(label, onData)` callback returning
`{ postMessage(command), terminate() }`. The transport sends `frame-ready` when
it can accept `uci`, UCI output lines as received, and `engineerror <message>`
on failure. The root export imports no Node built-ins.

Run `npm run check` for local structural tests. The real Stockfish conformance
suite runs when installed single-thread JS launchers are supplied:

```sh
STOCKFISH_18_JS=/path/to/stockfish-18-single.js \
STOCKFISH_19_JS=/path/to/stockfish-19-single.js \
node --test test/stockfish-conformance.test.mjs
```

The real suite covers the two-legal-replies MultiPV3 regression, fresh and warm
processes, depth/nodes/movetime, root restriction, provenance, cancellation,
search timeout, and crash cleanup for each supplied version. Structural process
tests also cover handshake failures and cleanup. Lc0 and Maia conformance require a
separate profile and runtime test with the actual engine and weights.
