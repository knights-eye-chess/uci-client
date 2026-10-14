// Generated from knightseye-net/tools/release-tooling; edit the canonical template and sync.
import { assertReleaseTooling } from './check-release-tooling.mjs';
assertReleaseTooling();
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const [name,input,registryVersion]=process.argv.slice(2);
const exact=/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
if(!name?.startsWith('@knights-eye-chess/')||!input)throw Error('Usage: node scripts/update-dependency.mjs @knights-eye-chess/name /absolute/package.tgz | --registry EXACT_VERSION | EXACT_VERSION');
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(!pkg.dependencies?.[name])throw Error('Not an existing package dependency');
const version=input==='--registry'?registryVersion:exact.test(input)?input:null;
if(input==='--registry'||version){
  if(!exact.test(version||''))throw Error('Expected exact registry version');
  const probe=spawnSync('npm',['view',`${name}@${version}`,'--json','--registry','https://registry.npmjs.org/'],{encoding:'utf8'});
  if(probe.status!==0)throw Error(probe.stderr||'Registry lookup failed');
  const metadata=JSON.parse(probe.stdout);
  if(metadata.name!==name||metadata.version!==version)throw Error('Registry identity/version mismatch');
  pkg.dependencies[name]=version;
  const release=JSON.parse(readFileSync('npm-release.json','utf8'));
  release.registryDependencies ||= {};
  release.registryDependencies[name]=version;
  writeFileSync('npm-release.json',JSON.stringify(release,null,2)+'\n');
  writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
  const lock=spawnSync('npm',['install','--package-lock-only','--ignore-scripts','--registry','https://registry.npmjs.org/'],{stdio:'inherit'});
  if(lock.status!==0)process.exit(lock.status||1);
  console.log(JSON.stringify({name,version,registry:'https://registry.npmjs.org/'}));
}else{
  const archive=path.resolve(input);
  const probe=spawnSync('tar',['-xOf',archive,'package/package.json'],{encoding:'utf8'});
  if(probe.status!==0)throw Error(probe.stderr);
  const metadata=JSON.parse(probe.stdout);
  if(!exact.test(metadata.version||'')||metadata.name!==name||(metadata.private!==true && !(metadata.publishConfig?.registry==='https://registry.npmjs.org/' && metadata.publishConfig?.access==='public' && metadata.publishConfig?.tag==='next')))throw Error('Expected matching private preview or registry candidate');
  const file=path.basename(archive),destination='vendor/npm/'+file;
  const bytes=readFileSync(archive),sha256=createHash('sha256').update(bytes).digest('hex');
  mkdirSync('vendor/npm',{recursive:true});
  if(existsSync(destination)&&createHash('sha256').update(readFileSync(destination)).digest('hex')!==sha256)throw Error('Refusing to overwrite a different immutable archive');
  copyFileSync(archive,destination);pkg.dependencies[name]='file:'+destination;writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
  const lock=spawnSync('npm',['install','--package-lock-only','--ignore-scripts'],{stdio:'inherit'});if(lock.status!==0)process.exit(lock.status||1);
  console.log(JSON.stringify({name,version:metadata.version,archive:destination,sha256}));
}
