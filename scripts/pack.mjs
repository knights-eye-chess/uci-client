// Generated from knightseye-net/tools/release-tooling; edit the canonical template and sync.
import { assertReleaseTooling } from './check-release-tooling.mjs';
assertReleaseTooling();
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync, chmodSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(process.argv[2] || path.join(root, 'artifacts'));
const release = JSON.parse(readFileSync(path.join(root, 'npm-release.json'), 'utf8'));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}
const listing = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']))[0];
const stage = mkdtempSync(path.join(os.tmpdir(), 'knights-eye-pack-'));
const output = mkdtempSync(path.join(os.tmpdir(), 'knights-eye-archive-'));
try {
  for (const { path: relative } of listing.files) {
    if (relative === 'npm-shrinkwrap.json' || relative === 'package-lock.json' || relative.startsWith('vendor/')) continue;
    const to = path.join(stage, relative);
    mkdirSync(path.dirname(to), { recursive: true });
    const source = path.join(root, relative);
    copyFileSync(source, to);
    chmodSync(to, statSync(source).mode & 0o111 ? 0o755 : 0o644);
  }
  const pkg = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'));
  const dependencies = pkg.dependencies || {};
  const mapping = release.registryDependencies || {};
  for (const [name, version] of Object.entries(mapping)) {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw Error(`Missing exact registry release version: ${name}`);
    const value = dependencies[name];
    if (!value) throw Error(`Unexpected registry release dependency: ${name}`);
    if (value.startsWith('file:')) {
      const original = JSON.parse(run('tar', ['-xOf', path.resolve(root, value.slice(5)), 'package/package.json']));
      if (original.name !== name) throw Error(`Dependency identity mismatch: ${name}`);
    } else if (value !== version) throw Error(`Registry dependency must match exact release version: ${name}`);
    dependencies[name] = version;
  }
  for (const [name, value] of Object.entries(dependencies)) {
    if (value.startsWith('file:') || (name.startsWith('@knights-eye-chess/') && !mapping[name])) throw Error(`Missing exact registry release version: ${name}`);
  }
  delete pkg.private;
  delete pkg.overrides;
  pkg.publishConfig = { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'next' };
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  chmodSync(path.join(stage, 'package.json'), 0o644);
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {});
  for (const entry of bins) {
    const target = path.resolve(stage, entry);
    if (!target.startsWith(stage + path.sep)) throw Error(`Invalid binary target: ${entry}`);
    chmodSync(target, 0o755);
  }
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], stage))[0];
  const bytes = readFileSync(path.join(output, packed.filename));
  mkdirSync(destination, { recursive: true });
  const target = path.join(destination, packed.filename);
  if (existsSync(target)) {
    if (!readFileSync(target).equals(bytes)) throw Error(`Archive is immutable: ${target}. Bump the version before changing its contents.`);
  } else writeFileSync(target, bytes, { flag: 'wx' });
  console.log(JSON.stringify({ ...packed, archive: target, sourcePrivate: true, registryDependencies: pkg.dependencies || {} }, null, 2));
} finally {
  rmSync(stage, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
}
