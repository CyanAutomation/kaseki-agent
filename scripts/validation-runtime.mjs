import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export function classifyRuntimeFailure(text) {
  if (/MmapAligned\(\) failed/.test(text) && /TCMalloc assumes a 48-bit virtual address space/i.test(text)) {
    return 'workerd_address_space_incompatible';
  }
  if (/Error[^\n]*\[vitest-pool\][^\n]*(?:Failed to start cloudflare-pool|Timeout starting cloudflare-pool)/.test(text)
      && /(?:write EPIPE|Timeout starting cloudflare-pool runner)/.test(text)) return 'workerd_startup_failed';
  return null;
}

const SIMPLE_COMMAND_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;
const SAFE_ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_./:@%+=,-]+$/;
const STATEFUL_SHELL_BUILTINS = new Set([
  '.', 'alias', 'break', 'builtin', 'cd', 'continue', 'declare', 'eval', 'exec', 'exit', 'export', 'local',
  'popd', 'pushd', 'read', 'readonly', 'return', 'set', 'shopt', 'source', 'trap', 'typeset', 'umask',
  'unalias', 'unset', 'wait',
]);

function splitSimpleAndChain(text) {
  const pieces = text.split(/\s*&&\s*/).map((piece) => piece.trim());
  if (pieces.length < 2) return undefined;
  for (const piece of pieces) {
    if (!piece) return undefined;
    const words = piece.split(/\s+/);
    let index = 0;
    while (index < words.length && SAFE_ENVIRONMENT_ASSIGNMENT.test(words[index])) index += 1;
    const executable = words[index];
    if (!executable || STATEFUL_SHELL_BUILTINS.has(executable)) return undefined;
    if (words.some((word) => !SIMPLE_COMMAND_TOKEN.test(word))) return undefined;
  }
  return pieces;
}

// Split only simple command lists. Quotes, redirections, pipes, control flow,
// and stateful builtins remain intact so separate shells preserve semantics.
export function expandValidationCommands(commands, scripts) {
  function expandOne(command, seen) {
    const match = /^npm run ([\w:.-]+)$/.exec(command);
    if (!match) return [command];
    const name = match[1];
    if (!scripts[name] || scripts[`pre${name}`] || scripts[`post${name}`] || seen.has(name) || seen.size >= 12) return [command];
    const nested = splitSimpleAndChain(scripts[name]);
    if (!nested) return [command];
    const next = new Set(seen).add(name);
    return nested.flatMap((piece) => expand(piece, next));
  }

  function expand(command, seen = new Set()) {
    const pieces = splitSimpleAndChain(command);
    if (pieces) return pieces.flatMap((piece) => expandOne(piece, seen));
    return expandOne(command.trim(), seen);
  }
  return commands.split(';').flatMap(command => expand(command.trim())).join(';');
}

function readOptional(file, limit = 65536, tail = false) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(limit);
      const offset = tail ? Math.max(0, fs.fstatSync(fd).size - limit) : 0;
      return buf.subarray(0, fs.readSync(fd, buf, 0, limit, offset)).toString('utf8').trim();
    } finally { fs.closeSync(fd); }
  } catch { return undefined; }
}

export function hostRuntimeIdentity() {
  let kernelConfig = readOptional(`/boot/config-${os.release()}`);
  if (!kernelConfig) {
    try { kernelConfig = gunzipSync(fs.readFileSync('/proc/config.gz'), { maxOutputLength: 1048576 }).toString(); } catch { /* Not every host exposes its kernel config. */ }
  }
  return {
    platform: os.platform(), arch: os.arch(), kernel: os.release(),
    pageSize: spawnSync('getconf', ['PAGESIZE'], { encoding: 'utf8', timeout: 1000 }).stdout?.trim(),
    addressSpaceConfig: kernelConfig?.split('\n').filter(line => /^CONFIG_ARM64_VA_BITS/.test(line)) || [],
    processLimits: readOptional('/proc/self/limits'),
    memoryLimit: readOptional('/sys/fs/cgroup/memory.max'),
    memoryEvents: readOptional('/sys/fs/cgroup/memory.events'),
    pidsLimit: readOptional('/sys/fs/cgroup/pids.max'),
  };
}

function requiredRuntimeDirectories(workspace, commands) {
  const required = new Set();
  const seen = new Set();
  function visit(dir, text) {
    if (seen.size >= 64 || (dir !== workspace && !dir.startsWith(workspace + path.sep))) return;
    const key = `${dir}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return; }
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    if (/\b(?:workerd|wrangler)\s+(?:test|serve|dev|types)\b/.test(text)
        || (/\bvitest(?:\s|$)/.test(text) && (dependencies['@cloudflare/vitest-pool-workers'] || dependencies['@cloudflare/vitest-plugin']))) required.add(dir);
    for (const match of text.matchAll(/\bnpm\s+(?:--prefix\s+([\w./-]+)\s+)?(?:run\s+)?([\w:.-]+)/g)) {
      const target = match[1] ? path.resolve(dir, match[1]) : dir;
      let scripts;
      try { scripts = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).scripts; } catch { continue; }
      if (typeof scripts?.[match[2]] === 'string') visit(target, scripts[match[2]]);
    }
  }
  visit(workspace, commands);
  return [...required];
}

function workerdBinaries(workspace, requiredDirs) {
  if (!fs.existsSync(workspace)) return [];
  const dirs = requiredDirs || [workspace];
  for (const group of requiredDirs ? [] : ['workers', 'packages']) {
    try {
      for (const entry of fs.readdirSync(path.join(workspace, group), { withFileTypes: true })) {
        if (entry.isDirectory() && dirs.length < 16) dirs.push(path.join(workspace, group, entry.name));
      }
    } catch { /* Optional workspace groups. */ }
  }
  const dependencyRoots = [workspace];
  for (const dir of dirs) {
    try { dependencyRoots.push(fs.realpathSync(path.join(dir, 'node_modules'))); } catch { /* Not installed here. */ }
  }
  const binaries = new Set();
  for (const dir of dirs) {
    try {
      const require = createRequire(path.join(dir, 'package.json'));
      const manifest = require.resolve('workerd/package.json');
      if (!dependencyRoots.some(root => manifest.startsWith(root + path.sep))) continue;
      let binary = path.join(path.dirname(manifest), 'bin/workerd');
      // Invoke the platform binary directly when present. Timing out npm's JS
      // wrapper can otherwise leave its synchronous native child running.
      const platform = os.platform() === 'win32' ? 'windows' : os.platform();
      const arch = os.arch() === 'x64' ? '64' : os.arch();
      const nativeRequire = createRequire(manifest);
      for (const dependency of [`@cloudflare/workerd-${platform}-${arch}`, `@workerd/${platform}-${arch}`]) {
        try {
          const nativeManifest = nativeRequire.resolve(`${dependency}/package.json`);
          const native = path.join(path.dirname(nativeManifest), 'bin', platform === 'windows' ? 'workerd.exe' : 'workerd');
          if (fs.existsSync(native)) { binary = native; break; }
        } catch { /* The package wrapper remains a fallback for other layouts. */ }
      }
      if (fs.existsSync(binary)) binaries.add(fs.realpathSync(binary));
    } catch { /* Not installed in this workspace. */ }
  }
  return [...binaries];
}

export function smokeWorkerd(workspace, commands) {
  const canonicalWorkspace = fs.existsSync(workspace) ? fs.realpathSync(workspace) : path.resolve(workspace);
  const requiredDirs = commands === undefined ? undefined : requiredRuntimeDirectories(canonicalWorkspace, commands);
  if (requiredDirs?.length === 0) return { status: 'not_required' };
  const binaries = workerdBinaries(canonicalWorkspace, requiredDirs);
  if (!binaries.length) return { status: 'not_installed', explanation: 'No installed workerd binary found; runtime errors will also be classified from validation output.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-workerd-smoke-'));
  const results = [];
  try {
    fs.writeFileSync(path.join(dir, 'worker.js'), 'export default { async test() { if (await new Response("ok").text() !== "ok") throw new Error("runtime smoke failed"); } };\n');
    fs.writeFileSync(path.join(dir, 'smoke.capnp'), 'using Workerd = import "/workerd/workerd.capnp";\nconst config :Workerd.Config = (services = [(name = "smoke", worker = (modules = [(name = "worker", esModule = embed "worker.js")], compatibilityDate = "2024-01-01"))]);\n');
    for (const binary of binaries) {
      const result = spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'workerd-smoke', binary, 'test', path.join(dir, 'smoke.capnp')], {
        encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536,
        // Avoid large native core dumps when an incompatible allocator aborts.
        cwd: dir,
      });
      const stderr = (result.stderr || '').slice(-8192);
      results.push({ binary, exitCode: result.status, signal: result.signal, stderr, error: result.error?.message });
      if (result.status !== 0 || result.error) return {
        status: 'failed', classification: classifyRuntimeFailure(stderr) || 'workerd_startup_failed', results,
        remediation: os.arch() === 'arm64'
          ? 'On a Raspberry Pi or other arm64 host, inspect CONFIG_ARM64_VA_BITS in /boot/config-$(uname -r) or /proc/config.gz and check process/container limits. Use a kernel and host compatible with this locked workerd binary. Keep integration tests enabled.'
          : 'Verify host virtual address capabilities and process/container limits; run validation on a host compatible with this locked workerd binary. Keep integration tests enabled.',
      };
    }
    return { status: 'passed', results };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'expand') {
    let scripts = {};
    try { scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts || {}; } catch { /* Preserve commands without a manifest. */ }
    process.stdout.write(expandValidationCommands(arg || '', scripts));
  } else if (mode === 'classify') {
    const reason = classifyRuntimeFailure(readOptional(arg, 1048576, true) || '');
    if (reason) process.stdout.write(reason);
    else process.exitCode = 1;
  } else if (mode === 'smoke') {
    const result = smokeWorkerd(arg || process.cwd(), process.argv[4]);
    process.stdout.write(JSON.stringify({ ...result, host: hostRuntimeIdentity() }) + '\n');
    if (result.status === 'failed') process.exitCode = 70;
  } else {
    console.error('Usage: node validation-runtime.mjs expand COMMANDS | classify LOG | smoke WORKSPACE [COMMANDS]');
    process.exitCode = 2;
  }
}
