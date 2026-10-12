import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  cleanupOldRuns,
  cleanupStaleStagingDirectories,
  hasActiveRunWorkspaceOrStaging,
  pruneNpmCache,
} from './cleanup-manager';

describe('storage cleanup helpers', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-storage-cleanup-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes only old staging directories whose run is not active', async () => {
    const resultsDir = path.join(root, 'results');
    const runsDir = path.join(root, 'runs');
    fs.mkdirSync(resultsDir);
    fs.mkdirSync(runsDir);
    fs.writeFileSync(path.join(resultsDir, '.kaseki-api-jobs.json'), JSON.stringify({
      jobs: [{ id: 'kaseki-7', status: 'running' }],
    }));

    const oldStaging = path.join(runsDir, '.staging-run-kaseki-8-abcd12');
    const activeStaging = path.join(resultsDir, '.staging-result-kaseki-7-efgh34');
    const recentStaging = path.join(resultsDir, '.staging-result-kaseki-9-ijkl56');
    const unrelated = path.join(runsDir, '.staging-not-a-run-abcd12');
    for (const directory of [oldStaging, activeStaging, recentStaging, unrelated]) {
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'data'), '1234');
    }
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(oldStaging, oldTime, oldTime);
    fs.utimesSync(activeStaging, oldTime, oldTime);
    fs.utimesSync(unrelated, oldTime, oldTime);
    expect(hasActiveRunWorkspaceOrStaging(resultsDir, runsDir)).toBe(true);

    const result = await cleanupStaleStagingDirectories(resultsDir, runsDir);

    expect(result.deletedCount).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(oldStaging)).toBe(false);
    expect(fs.existsSync(activeStaging)).toBe(true);
    expect(fs.existsSync(recentStaging)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it('prunes only npm mutable cache directories and preserves dependency cache and logs', () => {
    const npmCache = path.join(root, 'npm-cache');
    for (const directory of ['_cacache', '_npx', '_logs', 'dependencies']) {
      fs.mkdirSync(path.join(npmCache, directory), { recursive: true });
      fs.writeFileSync(path.join(npmCache, directory, 'entry'), 'cache-data');
    }

    const result = pruneNpmCache(npmCache);

    expect(result.deletedCount).toBe(2);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(npmCache, '_cacache'))).toBe(false);
    expect(fs.existsSync(path.join(npmCache, '_npx'))).toBe(false);
    expect(fs.existsSync(path.join(npmCache, '_logs', 'entry'))).toBe(true);
    expect(fs.existsSync(path.join(npmCache, 'dependencies', 'entry'))).toBe(true);
  });

  it('can apply run retention while preserving every shared cache entry', async () => {
    const resultsDir = path.join(root, 'results');
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(resultsDir);
    fs.mkdirSync(cacheDir);
    const oldRun = path.join(resultsDir, 'kaseki-1');
    const retainedRun = path.join(resultsDir, 'kaseki-2');
    fs.mkdirSync(oldRun);
    fs.mkdirSync(retainedRun);
    fs.writeFileSync(path.join(oldRun, 'artifact'), 'old');
    fs.writeFileSync(path.join(retainedRun, 'artifact'), 'new');

    // Make retention ordering independent of filesystem timestamp precision
    // and directory enumeration order.
    const retainedRunTime = new Date(Date.now() - 60 * 60 * 1000);
    const oldRunTime = new Date(retainedRunTime.getTime() - 60 * 60 * 1000);
    fs.utimesSync(oldRun, oldRunTime, oldRunTime);
    fs.utimesSync(retainedRun, retainedRunTime, retainedRunTime);
    const cacheEntry = path.join(cacheDir, 'dependency-entry');
    fs.mkdirSync(cacheEntry);
    fs.writeFileSync(path.join(cacheEntry, '.used-by-runs'), 'kaseki-1\n');
    fs.writeFileSync(path.join(cacheEntry, 'package.tgz'), 'shared cache data');

    const result = await cleanupOldRuns(resultsDir, cacheDir, 1, false, { preserveCache: true });

    expect(result.deletedCount).toBe(1);
    expect(fs.existsSync(oldRun)).toBe(false);
    expect(fs.existsSync(retainedRun)).toBe(true);
    expect(fs.existsSync(path.join(cacheEntry, 'package.tgz'))).toBe(true);
  });
});
