import { readProcessMemory } from './process-memory.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import { createUciClient, validProfile } from './index.mjs';
import { readCpuSnapshot, cpuStatDelta } from './cpu-diagnostics.mjs';
export { readCpuSnapshot, parseCpuQuota, parseCpuStat, cpuStatDelta } from './cpu-diagnostics.mjs';

const abortError = () => new Error('Analysis cancelled.');
const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000;
const text = value => value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
const boundedInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Dedicated children remain the default. Optional warm reuse belongs to one
 * host/job; it rejects concurrent leases rather than creating a hidden queue.
 * Errors/cancellation drain the child before another search can acquire it. */
export const stockfishProfile = Object.freeze({ id: 'stockfish', command: 'stockfish', args: [],
  setoptions: { Threads: 1, Hash: 16 }, compilerCommand: 'compiler',
  capabilities: { depth: true, nodes: true, movetime: true, multiPv: true,
    searchmoves: true, wdl: true, moveStats: false } });

export function createProcessEngine({ profile, command, args, timeoutMs = 65000,
  handshakeTimeoutMs = 5000, shutdownGraceMs = 250, spawnProcess = spawn, onSpawn,
  reuseProcess = false, threads = 1, hashMb = 16, onSearchDiagnostics } = {}) {
  const selected = profile ? { ...profile, command: command ?? profile.command, args: args ?? profile.args } :
    { ...stockfishProfile, command: command ?? stockfishProfile.command, args: args ?? [],
      setoptions: { Threads: threads, Hash: hashMb } };
  if (!validProfile(selected) ||
    [timeoutMs, handshakeTimeoutMs, shutdownGraceMs].some(value => !boundedInteger(value, 1, 2147483647)) ||
    typeof reuseProcess !== 'boolean' || !boundedInteger(threads, 1, 256) || !boundedInteger(hashMb, 1, 65536) ||
    (onSearchDiagnostics !== undefined && typeof onSearchDiagnostics !== 'function')) {
    throw new TypeError('Invalid engine process configuration.');
  }
  let queue = Promise.resolve(), closed = false, busy = false, session = null;
  const shutdown = new AbortController();

  function createSession() {
    const started = performance.now();
    const child = spawnProcess(selected.command, [...selected.args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const input = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let resolveClose, waiter = null, receiver = null, terminating = false, killTimer;
    let name = '', compiler = null, binaryVariant = null, collectCompiler = false, compilerLines = [];
    const options = new Map();
    const childClosed = new Promise(resolve => { resolveClose = resolve; });
    function stop() {
      if (terminating) return;
      terminating = true;
      waiter?.reject(abortError());
      try { child.stdin.end('stop\nquit\n'); } catch { /* Force kill still follows. */ }
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, shutdownGraceMs);
    }
    function failure(error) {
      waiter?.reject(error);
      receiver?.('engineerror Engine process failed.');
      stop();
    }
    child.once('error', failure);
    child.stdin.on('error', failure);
    child.stdout.on('error', failure);
    child.stderr.resume();
    child.stderr.on('error', failure);
    child.once('close', () => {
      clearTimeout(killTimer);
      input.close();
      waiter?.reject(new Error('Engine exited before completing command.'));
      if (!terminating) receiver?.('engineerror Engine exited before completing search.');
      terminating = true;
      resolveClose();
    });
    input.on('line', line => {
      if (terminating) return;
      if (line.startsWith('id name ')) name = text(line.slice(8)).slice(0, 200);
      const option = /^option name (.+?) type (spin|check|string|combo|button)(?:\s|$)/.exec(line);
      if (option) {
        const min = /\bmin (-?\d+)\b/.exec(line), max = /\bmax (-?\d+)\b/.exec(line);
        options.set(option[1], { type: option[2], min: min ? Number(min[1]) : null,
          max: max ? Number(max[1]) : null });
      }
      const variant = /^info string knightseye binary variant (baseline|avx2)$/.exec(line);
      if (variant) binaryVariant = variant[1];
      if (collectCompiler && line !== 'readyok' && compilerLines.join('\n').length < 1000) compilerLines.push(text(line).slice(0, 300));
      if (waiter?.line === line) waiter.resolve();
      receiver?.(line);
    });
    function write(line) {
      if (terminating) throw new Error('Engine process unavailable.');
      child.stdin.write(line + '\n');
    }
    async function waitFor(line, commandText, signal) {
      signal?.throwIfAborted();
      if (waiter) throw new Error('Overlapping engine command.');
      let timer, abort;
      try {
        await new Promise((resolve, reject) => {
          waiter = { line, resolve, reject };
          timer = setTimeout(() => reject(new Error('UCI handshake/readiness timed out.')), handshakeTimeoutMs);
          abort = () => reject(abortError());
          signal?.addEventListener('abort', abort, { once: true });
          write(commandText);
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        waiter = null;
      }
    }
    async function initialize(signal) {
      onSpawn?.(child);
      await waitFor('uciok', 'uci', signal);
      if (!name) throw new Error('Engine supplied no UCI id name.');
      for (const [key, value] of Object.entries(selected.setoptions ?? {})) {
        const advertised = options.get(key);
        if (!advertised) {
          if (!(profile === undefined && ((key === 'Threads' && value === 1) || (key === 'Hash' && value === 16))))
            throw new Error('Engine does not advertise ' + key + '.');
        } else {
          const compatible = advertised.type === 'spin' ? Number.isSafeInteger(value) &&
            (advertised.min === null || value >= advertised.min) &&
            (advertised.max === null || value <= advertised.max) :
            advertised.type === 'check' ? typeof value === 'boolean' :
              advertised.type === 'string' || advertised.type === 'combo' ? typeof value === 'string' : false;
          if (!compatible) throw new Error('Unsupported engine option ' + key + '.');
          write('setoption name ' + key + ' value ' + String(value));
        }
      }
      collectCompiler = true;
      if (selected.compilerCommand) write(selected.compilerCommand);
      await waitFor('readyok', 'isready', signal);
      collectCompiler = false;
      compiler = compilerLines.length ? compilerLines.join('\n').slice(0, 1000) : null;
      return elapsed(started);
    }
    return { child, options, initialize, waitFor, write, stop, childClosed,
      get name() { return name; }, get compiler() { return compiler; }, get binaryVariant() { return binaryVariant; },
      get terminating() { return terminating; }, set receiver(value) { receiver = value; } };
  }

  async function search(request) {
    const signal = request.signal ? AbortSignal.any([request.signal, shutdown.signal]) : shutdown.signal;
    if (closed || signal.aborted) throw abortError();
    const started = performance.now();
    const reused = !!session && !session.terminating;
    // An idle child can fail between leases. Its stop/kill drain must complete
    // before its replacement is acquired, just like an in-flight failure.
    if (session?.terminating) {
      await session.childClosed;
      session = null;
      if (closed || signal.aborted) throw abortError();
    }
    if (!reused) session = createSession();
    const current = session;
    let initializationMs = 0, searchStarted, cpuBefore, nodes = null, nps = null, hashfull = null;
    const candidateNodes = new Map();
    const abort = () => current.stop();
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!reused) initializationMs = await current.initialize(signal);
      if (signal.aborted) throw abortError();
      if ((request.multiPv || 1) > 1 && !current.options.has('MultiPV')) throw new Error('Engine does not advertise MultiPV.');
      const adapter = createUciClient((_label, onData) => {
        current.receiver = line => {
          if (line.startsWith('info ')) {
            const numericInfo = line.split(/(?:^|\s)string(?:\s|$)/, 1)[0];
            const fullness = /(?:^|\s)hashfull\s+(\d+)(?=\s|$)/.exec(numericInfo);
            if (fullness && boundedInteger(Number(fullness[1]), 0, 1000)) hashfull = Number(fullness[1]);
            const count = /\bnodes (\d+)\b/.exec(line), rate = /\bnps (\d+)\b/.exec(line);
            if (count && Number.isSafeInteger(Number(count[1]))) nodes = Number(count[1]);
            if (rate && Number.isSafeInteger(Number(rate[1]))) nps = Number(rate[1]);
            if (count && line.includes(' pv ')) {
              const index = Number(/\bmultipv (\d+)\b/.exec(line)?.[1] ?? 1);
              const depth = Number(/\bdepth (\d+)\b/.exec(line)?.[1]);
              if (Number.isSafeInteger(depth) && Number.isSafeInteger(Number(count[1]))) candidateNodes.set(index, { depth, nodes: Number(count[1]) });
            }
          }
          onData(line);
        };
        queueMicrotask(() => { if (!current.terminating) onData('frame-ready'); });
        return { postMessage(commandText) {
          if (signal.aborted) throw abortError();
          // The actual name/options handshake has already completed. The adapter
          // still follows its usual readiness protocol for every finite search.
          if (commandText === 'uci') queueMicrotask(() => { if (!current.terminating) onData('uciok'); });
          else if (Object.entries(selected.setoptions ?? {}).some(([name, value]) =>
            commandText === 'setoption name ' + name + ' value ' + String(value))) {
            // Profile options were applied during handshake. Reapplying Hash on
            // every warm search can clear the transposition table.
          }
          else {
            if (commandText.startsWith('go ')) {
              cpuBefore = readCpuSnapshot();
              searchStarted = performance.now();
            }
            current.write(commandText);
          }
        }, terminate() { /* Outer settlement owns process reuse or drain. */ } };
      }, { timeoutMs, profile: { ...selected, engineBuild: current.name } });
      const result = await adapter.search({ ...request, signal });
      const searchElapsedMs = elapsed(searchStarted ?? started);
      const cpuAfter = readCpuSnapshot();
      current.receiver = null;
      // A readiness round-trip fences late info/bestmove output from the next
      // lease, without clearing the warm transposition table.
      await current.waitFor('readyok', 'isready', signal);
      if (signal.aborted) throw abortError();
      for (const candidate of result.candidates) {
        const count = candidateNodes.get(candidate.multipv);
        candidate.nodes = count?.depth === candidate.depth ? count.nodes : null;
      }
      result.nodes = result.candidates[0]?.nodes ?? nodes;
      result.diagnostics = { schema: 'native-engine-search/1', processReused: reused,
        processInitializationMs: initializationMs, searchElapsedMs, totalElapsedMs: elapsed(started),
        nodes, nps, hashfull, processMemory: readProcessMemory(current.child.pid), threads: selected.setoptions?.Threads ?? null,
        hashMb: selected.setoptions?.Hash ?? null, compiler: current.compiler, binaryVariant: current.binaryVariant,
        cpuModel: cpuBefore?.cpuModel ?? cpuAfter.cpuModel,
        loadAverageBefore: cpuBefore?.loadAverage ?? null, loadAverageAfter: cpuAfter.loadAverage,
        cpuQuota: cpuBefore?.cpuQuota ?? null,
        cpuStatBefore: cpuBefore?.cpuStat ?? null, cpuStatAfter: cpuAfter.cpuStat,
        cpuStatDelta: cpuStatDelta(cpuBefore?.cpuStat, cpuAfter.cpuStat) };
      try { onSearchDiagnostics?.(result.diagnostics); } catch { /* Observers do not own result settlement. */ }
      if (!reuseProcess) { current.stop(); await current.childClosed; session = null; }
      return result;
    } catch (error) {
      current.receiver = null;
      current.stop();
      await current.childClosed;
      if (session === current) session = null;
      if (signal.aborted) throw abortError();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  return {
    search(request) {
      if (reuseProcess && busy) return Promise.reject(new Error('Engine capacity exhausted.'));
      if (closed) return Promise.reject(abortError());
      if (reuseProcess) busy = true;
      const pending = queue.then(() => search(request));
      queue = pending.then(() => undefined, () => undefined);
      if (reuseProcess) pending.then(() => { busy = false; }, () => { busy = false; });
      return pending;
    },
    async close() {
      closed = true;
      shutdown.abort();
      await queue;
      if (session) { session.stop(); await session.childClosed; session = null; }
    },
  };
}
