const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const validMove = move => typeof move === 'string' && UCI_MOVE.test(move) &&
  move.slice(0, 2) !== move.slice(2, 4) && (move.length === 4 || move[3] === '1' || move[3] === '8');
const safeText = value => typeof value === 'string' && value.length > 0 && !/[\r\n\u0000]/.test(value);

/** The protocol layer has no chess rules and no Node imports. An acquire
 * callback may connect a Worker, process, or a host-managed engine lease. */
export function createUciClient(acquire, { profile, timeoutMs = 65000 } = {}) {
  if (typeof acquire !== 'function' || !validProfile(profile) || !positive(timeoutMs))
    throw new TypeError('Invalid UCI client configuration.');
  return { search(request) {
    const limit = request?.limit;
    const kinds = limit && typeof limit === 'object' ? ['depth', 'nodes', 'movetime'].filter(key => Object.hasOwn(limit, key)) : [];
    const kind = kinds[0];
    const count = request?.multiPv ?? 1;
    const roots = request?.rootMoves ?? [];
    const requireRootCoverage = request?.requireRootCoverage ?? (roots.length > 0);
    const caps = profile.capabilities;
    if (!safeText(request?.fen) || kinds.length !== 1 || !positive(limit[kind]) ||
      !caps[kind] || !positive(count) || count > 256 || (count > 1 && !caps.multiPv) ||
      !Array.isArray(roots) || roots.length > 256 || roots.some(move => !validMove(move)) ||
      new Set(roots).size !== roots.length || typeof requireRootCoverage !== 'boolean' ||
      (roots.length > 0 && !caps.searchmoves) || (requireRootCoverage && roots.length > count))
      return Promise.reject(new Error('Invalid or unsupported UCI search request.'));
    return new Promise((resolve, reject) => {
      let port = null, done = false, frameReady = false, ready = false;
      const found = new Map(), moveStats = new Map();
      const timer = setTimeout(() => finish(new Error('UCI analysis timed out.')), timeoutMs);
      const abort = () => finish(new Error('Analysis cancelled.'));
      function finish(error, bestmove) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        try { port?.terminate(); } catch { /* This search still settles. */ }
        if (error) { reject(error); return; }
        // MultiPV is an upper bound when the legal position has fewer replies.
        const candidates = [...found.values()].sort((a, b) => a.multipv - b.multipv);
        const engineBuild = profile.engineBuild ?? profile.id;
        if (bestmove === '(none)' && candidates.length === 0) {
          if (requireRootCoverage && roots.length > 0) {
            reject(new Error('UCI engine did not complete requested score and root coverage.'));
            return;
          }
          // UCI reports no move, not why the board has no move. The host must
          // verify legal terminality before treating this as a chess outcome.
          resolve({ noMove: true, bestmove: null, candidates: [], engineBuild,
            ...(profile.weightsId ? { weightsId: profile.weightsId } : {}) });
          return;
        }
        const complete = candidates.length > 0 && candidates.every(line => line.pv.length > 0 &&
          (line.scoreCp !== null || line.mate !== null) && (kind !== 'depth' || line.depth >= limit.depth));
        const covered = complete && new Set(candidates.map(line => line.pv[0])).size === candidates.length &&
          (!roots.length || candidates.every(line => roots.includes(line.pv[0])) &&
            (!requireRootCoverage || roots.every(root => candidates.some(line => line.pv[0] === root))));
        if (!covered || !validMove(bestmove) || candidates[0].pv[0] !== bestmove) {
          reject(new Error('UCI engine did not complete requested score and root coverage.'));
          return;
        }
        const root = candidates[0];
        resolve({ ...root, noMove: false, engineBuild,
          ...(profile.weightsId ? { weightsId: profile.weightsId } : {}),
          depth: Math.min(...candidates.map(line => line.depth)), bestmove, candidates,
          ...(moveStats.size ? { moveStats: Object.fromEntries(moveStats) } : {}) });
      }
      if (request.signal?.aborted) { abort(); return; }
      request.signal?.addEventListener('abort', abort, { once: true });
      try {
        port = acquire('UCI analysis', line => {
          if (done) return;
          try {
            if (line.startsWith('engineerror ')) { finish(new Error(line.slice(12))); return; }
            if (line === 'frame-ready') {
              frameReady = true;
              port?.postMessage('uci');
            } else if (line === 'uciok') {
              for (const [name, value] of Object.entries(profile.setoptions ?? {}))
                port?.postMessage('setoption name ' + name + ' value ' + String(value));
              if (caps.multiPv) port?.postMessage('setoption name MultiPV value ' + count);
              port?.postMessage('isready');
            } else if (line === 'readyok' && !ready) {
              ready = true;
              port?.postMessage('position fen ' + request.fen);
              port?.postMessage('go ' + kind + ' ' + limit[kind] + (roots.length ? ' searchmoves ' + roots.join(' ') : ''));
            } else if (line.startsWith('info ')) {
              if (caps.moveStats && typeof profile.parseMoveStats === 'function') {
                const stat = profile.parseMoveStats(line);
                if (stat && validMove(stat.move) && typeof stat.prior === 'number' &&
                  Number.isFinite(stat.prior) && stat.prior >= 0 && stat.prior <= 1)
                  moveStats.set(stat.move, { prior: stat.prior });
              }
              if (!line.includes(' pv ')) return;
              const depth = Number(/\bdepth (\d+)\b/.exec(line)?.[1] ?? NaN);
              const index = Number(/\bmultipv (\d+)\b/.exec(line)?.[1] ?? 1);
              const scores = [...line.matchAll(/\bscore (cp|mate) (-?\d+)(?=\s|$)/g)];
              const score = scores.length === 1 ? Number(scores[0][2]) : null;
              const pv = /\bpv\s+(.+)$/.exec(line)?.[1].trim().split(/\s+/) ?? [];
              if (!Number.isSafeInteger(depth) || depth < 0 || !positive(index) || index > count || score === null ||
                !Number.isSafeInteger(score) || !pv.length || pv.some(move => !validMove(move)) ||
                /\b(?:lowerbound|upperbound)\b/.test(line)) return;
              const wdlParts = caps.wdl ? /\bwdl (\d+) (\d+) (\d+)\b/.exec(line) : null;
              const wdl = wdlParts && wdlParts.slice(1).every(part => Number.isSafeInteger(Number(part)))
                ? { win: Number(wdlParts[1]), draw: Number(wdlParts[2]), loss: Number(wdlParts[3]) } : undefined;
              const candidate = { multipv: index, depth, scoreCp: scores[0][1] === 'cp' ? score : null,
                mate: scores[0][1] === 'mate' ? score : null, pv,
                ...(wdl ? { wdl } : {}),
                scoreProvenance: { kind: 'root-search', fen: request.fen, originatingDepth: depth,
                  reportedDepth: depth, engineBuild: profile.engineBuild ?? profile.id,
                  requestedLimit: { [kind]: limit[kind] }, ...(profile.weightsId ? { weightsId: profile.weightsId } : {}) } };
              if (!found.has(index) || found.get(index).depth <= depth) found.set(index, candidate);
            } else if (line.startsWith('bestmove')) {
              finish(undefined, /^bestmove\s+(\S+)/.exec(line)?.[1]);
            }
          } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
        });
        if (done) {
          try { port.terminate(); } catch { /* Synchronous transport settled. */ }
        } else if (frameReady) port.postMessage('uci');
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  } };
}

export function validProfile(profile) {
  if (!profile || !safeText(profile.id) || !safeText(profile.command) ||
    !Array.isArray(profile.args) || profile.args.some(arg => !safeText(arg)) ||
    !profile.capabilities || typeof profile.capabilities !== 'object' ||
    !['depth', 'nodes', 'movetime', 'multiPv', 'searchmoves', 'wdl', 'moveStats'].every(key => typeof profile.capabilities[key] === 'boolean') ||
    (profile.engineBuild !== undefined && !safeText(profile.engineBuild)) ||
    (profile.weightsId !== undefined && !safeText(profile.weightsId)) ||
    (profile.compilerCommand !== undefined && !safeText(profile.compilerCommand)) ||
    (profile.parseMoveStats !== undefined && typeof profile.parseMoveStats !== 'function')) return false;
  const options = profile.setoptions ?? {};
  return options && typeof options === 'object' && !Array.isArray(options) &&
    Object.entries(options).every(([key, value]) => safeText(key) && key !== 'MultiPV' &&
      /^(?:[\x20-\x7e]+)$/.test(key) &&
      (typeof value === 'string' ? safeText(value) && /^[\x20-\x7e]*$/.test(value) :
        typeof value === 'boolean' || Number.isSafeInteger(value)));
}
