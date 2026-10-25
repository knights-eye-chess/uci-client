// Structural process fixture, deliberately not real engine evidence.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const mode = process.argv[2] || 'normal';
const input = createInterface({ input: process.stdin });
let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', count = 1, threads = 1, hash = 16;
let searchCount = 0, resetPending = false;
if (mode === 'hang') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
input.on('line', line => {
  if (line === 'uci' && mode !== 'handshake-hang') {
    if(mode !== 'no-clear-hash') process.stdout.write('option name Clear Hash type button\n');
    process.stdout.write('id name Structural fixture 1\noption name MultiPV type spin default 1 min 1 max 256\noption name Threads type spin default 1 min 1 max 256\noption name Hash type spin default 16 min 1 max 65536\noption name WeightsFile type string default <empty>\noption name UCI_ShowWDL type check default false\nuciok\n');
  } else if (line === 'compiler') process.stdout.write('Fixture compiler SSE2\n');
  else if (line.startsWith('setoption name Threads value ')) threads = Number(line.split(' ').at(-1));
  else if (line.startsWith('setoption name Hash value ')) hash = Number(line.split(' ').at(-1));
  else if (line === 'ucinewgame' || line === 'setoption name Clear Hash') { searchCount = 0; resetPending = true; process.stdout.write('info string reset-started\n'); }
  else if (line === 'isready') {
    if (resetPending && mode === 'reset-hang') return;
    if (resetPending && mode === 'reset-delay') setTimeout(() => { resetPending = false; process.stdout.write('readyok\n'); }, 40);
    else { resetPending = false; process.stdout.write('readyok\n'); }
  }
  else if (line.startsWith('setoption name MultiPV value ')) count = Number(line.split(' ').at(-1));
  else if (line.startsWith('position fen ')) fen = line.slice(13);
  else if (/^go (depth|nodes|movetime) /.test(line)) {
    if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
    if (resetPending) process.exit(9);
    searchCount++;
    if (mode === 'hang') return;
    if (mode === 'exit') process.exit(7);
    const depth = Number(line.split(' ')[2]);
    const roots = line.includes(' searchmoves ') ? line.split(' searchmoves ')[1].split(' ') :
      ['e2e4', 'd2d4', 'g1f3'].slice(0, count);
    roots.forEach((root, index) => process.stdout.write(`info depth ${depth} multipv ${index + 1} score cp ${20 - index * 10 + (mode === 'history-sensitive' ? searchCount : 0)} nodes ${1234 + threads + hash} nps 4567 ${['no-hashfull','string-hashfull','mixed-string-hashfull'].includes(mode) ? '' : mode === 'invalid-hashfull' ? 'hashfull 1001' : mode === 'decimal-hashfull' ? 'hashfull 23.4' : mode === 'suffix-hashfull' ? 'hashfull 23oops' : 'hashfull 237'} pv ${root}\n`));
    if (mode === 'mixed-string-hashfull') process.stdout.write('info depth 4 string hashfull 237\n');
    if (mode === 'string-hashfull') process.stdout.write('info string hashfull 237\n');
    process.stdout.write(`bestmove ${roots[0]}\n`);
  } else if (line === 'quit' && mode !== 'hang') process.exit(0);
});
