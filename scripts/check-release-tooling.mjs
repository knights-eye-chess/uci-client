// Generated from knightseye-net/tools/release-tooling; edit the canonical template and sync.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function assertReleaseTooling(root = fileURLToPath(new URL('../', import.meta.url))) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/release-tooling.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.canonical !== 'knightseye-net/tools/release-tooling') throw Error('Invalid release tooling stamp');
  const required = ['scripts/pack.mjs', 'scripts/publish-reviewed.mjs', '.github/workflows/npm-publish.yml', 'scripts/verify-release.mjs', 'scripts/update-dependency.mjs', 'scripts/check-release-tooling.mjs', '.github/workflows/quality.yml'];
  if (!manifest.sha256 || required.some(relative => !/^[a-f0-9]{64}$/.test(manifest.sha256[relative] || ''))) throw Error('Incomplete release tooling stamp');
  for (const [relative, expected] of Object.entries(manifest.sha256)) {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw Error(`Invalid tooling path: ${relative}`);
    const actual = createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex');
    if (actual !== expected) throw Error(`Release tooling drift: ${relative}. Sync from ${manifest.canonical} before releasing.`);
  }
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertReleaseTooling();
  console.log('Release tooling stamp verified');
}
