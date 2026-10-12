import type { KasekiApiConfig } from './kaseki-api-config';
import {
  StorageCapacityError,
  StorageCapacityManager,
  type StorageCleanupSummary,
} from './storage-capacity';

function makeConfig(): KasekiApiConfig {
  return {
    resultsDir: '/tmp/kaseki-results',
    runsDir: '/tmp/kaseki-runs',
    cacheDir: '/tmp/kaseki-cache',
    npmCacheDir: '/tmp/kaseki-cache/npm-cache',
    retentionRuns: 5,
    storageWarnFreeBytes: 5 * 1024 ** 3,
    storageMinFreeBytes: 2 * 1024 ** 3,
  } as KasekiApiConfig;
}

describe('StorageCapacityManager', () => {
  it('runs one cleanup below the warning threshold and admits when capacity recovers', async () => {
    const readings = [4 * 1024 ** 3, 6 * 1024 ** 3];
    const cleanup = jest.fn<Promise<StorageCleanupSummary>, [boolean]>(async () => ({ freedBytes: 2 * 1024 ** 3 }));
    const manager = new StorageCapacityManager(makeConfig(), {
      measureAvailableBytes: () => readings.shift() ?? 6 * 1024 ** 3,
      cleanup,
      hasActiveRuns: () => false,
    });

    const status = await manager.ensureCapacity();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(true);
    expect(status.state).toBe('ok');
    expect(status.availableBytes).toBe(6 * 1024 ** 3);
    expect(status.cleanupFreedBytes).toBe(2 * 1024 ** 3);
  });

  it('rejects admission with structured storage details when cleanup cannot reach the minimum', async () => {
    const manager = new StorageCapacityManager(makeConfig(), {
      measureAvailableBytes: () => 1024 ** 3,
      cleanup: async () => ({ freedBytes: 0 }),
      hasActiveRuns: () => false,
    });

    await expect(manager.ensureCapacity()).rejects.toMatchObject<Partial<StorageCapacityError>>({
      code: 'insufficient_storage',
      statusCode: 507,
      availableBytes: 1024 ** 3,
      minimumBytes: 2 * 1024 ** 3,
      cleanupAttempted: true,
    });
  });

  it('fails closed when free space cannot be measured', async () => {
    const cleanup = jest.fn<Promise<StorageCleanupSummary>, [boolean]>(async () => ({ freedBytes: 0 }));
    const manager = new StorageCapacityManager(makeConfig(), {
      measureAvailableBytes: () => null,
      cleanup,
      hasActiveRuns: () => false,
    });

    await expect(manager.ensureCapacity()).rejects.toMatchObject({
      code: 'storage_capacity_unknown',
      statusCode: 503,
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('does not prune the shared npm cache while a run is active', async () => {
    const cleanup = jest.fn<Promise<StorageCleanupSummary>, [boolean]>(async () => ({ freedBytes: 0 }));
    const manager = new StorageCapacityManager(makeConfig(), {
      measureAvailableBytes: () => 4 * 1024 ** 3,
      cleanup,
      hasActiveRuns: () => true,
    });

    await manager.ensureCapacity();

    expect(cleanup).toHaveBeenCalledWith(false);
  });

  it('shares an in-progress cleanup across concurrent admissions', async () => {
    let releaseCleanup: ((summary: StorageCleanupSummary) => void) | undefined;
    const cleanup = jest.fn<Promise<StorageCleanupSummary>, [boolean]>(() => new Promise((resolve) => {
      releaseCleanup = resolve;
    }));
    const manager = new StorageCapacityManager(makeConfig(), {
      measureAvailableBytes: () => 4 * 1024 ** 3,
      cleanup,
      hasActiveRuns: () => false,
    });

    const first = manager.ensureCapacity();
    const second = manager.ensureCapacity();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    releaseCleanup?.({ freedBytes: 0 });

    const statuses = await Promise.all([first, second]);
    expect(statuses.every((status) => status.state === 'warning')).toBe(true);
  });
});
