// Shared by the API and Bash worker; this file is shipped in the npm artifact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function resolvePackageManager(manifest, files = [], requireLock = true) {
  const declared = manifest?.packageManager;
  let manager;
  let requestedVersion = '';
  if (declared !== undefined) {
    const match = /^(npm|bun)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+sha(?:224|256|384|512)\.[0-9a-fA-F]+)?$/.exec(declared);
    if (!match) throw new Error('packageManager must pin npm or bun to an exact version (for example bun@1.4.3).');
    [, manager, requestedVersion] = match;
  }
  const npmLocks = ['npm-shrinkwrap.json', 'package-lock.json'].filter(file => files.includes(file));
  const bunLocks = ['bun.lock', 'bun.lockb'].filter(file => files.includes(file));
  if (files.includes('pnpm-lock.yaml') || files.includes('yarn.lock')) {
    throw new Error('Unsupported package manager lockfile: only npm and Bun target repositories are supported.');
  }
  if ((npmLocks.length && bunLocks.length) || bunLocks.length > 1) {
    throw new Error('Ambiguous lockfiles: keep the lockfile for exactly one package manager.');
  }
  const detected = bunLocks.length ? 'bun' : npmLocks.length ? 'npm' : undefined;
  if (manager && detected && manager !== detected) throw new Error('packageManager conflicts with the repository lockfile.');
  manager = manager || detected || 'npm';
  const lockfile = (manager === 'bun' ? bunLocks[0] : npmLocks[0]) || '';
  if (requireLock && !lockfile) throw new Error('Dependency install requires package-lock.json, npm-shrinkwrap.json, bun.lock, or bun.lockb; lockfile missing.');
  const localDependencies = Object.values({ ...manifest?.dependencies, ...manifest?.devDependencies, ...manifest?.optionalDependencies })
    .some(value => typeof value === 'string' && /^(file:|link:|workspace:|\.|\/)/.test(value));
  const treeCacheSafe = !manifest?.workspaces && !localDependencies && !manifest?.patchedDependencies;
  return { manager, lockfile, requestedVersion, workspaces: Boolean(manifest?.workspaces), treeCacheSafe };
}

function packageScriptCommand(manager, script) {
  if (!['npm', 'bun'].includes(manager) || !/^[A-Za-z0-9:_./-]+$/.test(script)) throw new Error('Invalid package script command.');
  return `${manager} run ${script}`;
}

// Include configuration and all workspace manifests, never credentials in output.
function dependencyInputHash(root, lockfile) {
  if (typeof lockfile !== 'string' || lockfile.length === 0) {
    throw new Error('dependencyInputHash requires a non-empty lockfile path');
  }
  const hash = crypto.createHash('sha256');
  const inputs = [lockfile];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', '.kaseki-cache'].includes(entry.name)) walk(relative);
      else if (entry.isFile() && ['package.json', '.npmrc', 'bunfig.toml'].includes(entry.name)) inputs.push(relative);
    }
  };
  walk('');
  for (const input of inputs.sort()) hash.update(input).update('\0').update(fs.readFileSync(path.join(root, input))).update('\0');
  return hash.digest('hex');
}

exports.resolvePackageManager = resolvePackageManager;
exports.packageScriptCommand = packageScriptCommand;
exports.dependencyInputHash = dependencyInputHash;

if (require.main === module) {
  try {
    const root = process.argv[3] || process.cwd();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const selection = resolvePackageManager(manifest, fs.readdirSync(root), process.argv[2] !== 'preview');
    if (process.argv[2] === 'hash') process.stdout.write(dependencyInputHash(root, selection.lockfile));
    else process.stdout.write([selection.manager, selection.lockfile || '-', selection.requestedVersion || '-', selection.workspaces ? '1' : '0', selection.treeCacheSafe ? '1' : '0'].join('\t'));
  } catch (error) {
    console.error(`Package manager: ${error.message}`);
    process.exitCode = 1;
  }
}
