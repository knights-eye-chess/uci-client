// Generated from knightseye-net/tools/release-tooling; edit the canonical template and sync.
import { assertReleaseTooling } from './check-release-tooling.mjs';
assertReleaseTooling();
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = source.name.replace(/^@/, '').replace('/', '-');
const archive = path.resolve(process.argv[2] || path.join(root, 'artifacts', `${name}-${source.version}.tgz`));
const stage = mkdtempSync(path.join(os.tmpdir(), 'knights-eye-verify-'));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}
function requirePath(relative) {
  if (!relative.startsWith('./') || relative.includes('..')) throw Error(`Invalid package target: ${relative}`);
  const target = path.join(stage, 'package', relative);
  if (relative.includes('*')) {
    const directory = path.dirname(target);
    if (!existsSync(directory) || !readdirSync(directory).length) throw Error(`Missing exported assets: ${relative}`);
  } else if (!existsSync(target)) throw Error(`Missing package target: ${relative}`);
}
try {
  run('tar', ['-xzf', archive, '-C', stage]);
  const pkg = JSON.parse(readFileSync(path.join(stage, 'package/package.json'), 'utf8'));
  if (pkg.name !== source.name || pkg.version !== source.version || pkg.private) throw Error('Unexpected identity or private package');
  if (pkg.publishConfig?.access !== 'public' || pkg.publishConfig.registry !== 'https://registry.npmjs.org/' || pkg.publishConfig.tag !== 'next') throw Error('Expected public npm prerelease settings');
  if (existsSync(path.join(stage, 'package/npm-shrinkwrap.json')) || existsSync(path.join(stage, 'package/vendor'))) throw Error('Source-only dependency pins leaked into the consumer package');
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [dependency, version] of Object.entries(pkg[section] || {})) {
      if (/^(file:|link:|workspace:|https?:|git)/.test(version)) throw Error(`Non-registry dependency: ${dependency}`);
    }
  }
  for (const [subpath, entry] of Object.entries(pkg.exports || {})) {
    if (typeof entry === 'string') requirePath(entry);
    else {
      if (!entry.types || !entry.import) throw Error(`Missing runtime/types export: ${subpath}`);
      requirePath(entry.types); requirePath(entry.import);
    }
  }
  for (const entry of Object.values(pkg.bin || {})) requirePath('./' + entry.replace(/^\.\//, ''));
  for (const file of ['LICENSE', 'NOTICE', 'LICENSING.md', 'THIRD_PARTY_NOTICES.md', 'SOURCE-ORIGIN.json', 'NPM-PUBLISHING.md']) requirePath('./' + file);
  const dryRun = JSON.parse(run('npm', ['publish', archive, '--dry-run', '--ignore-scripts', '--access', 'public', '--tag', 'next', '--registry', 'https://registry.npmjs.org/', '--json']));
  console.log(JSON.stringify({ package: pkg.name, version: pkg.version, archive, registryDependencies: pkg.dependencies || {}, files: dryRun.files?.length, dryRun: true, registryWrite: false }, null, 2));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
