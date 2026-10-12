import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KasekiApiConfig } from './kaseki-api-config';
import { metricsRegistry } from './metrics';

const CLEANUP_COOLDOWN_MS = 5 * 60 * 1000;

export type StorageCapacityState = 'ok' | 'warning' | 'blocked' | 'unknown';

export interface StorageCapacityStatus {
  state: StorageCapacityState;
  availableBytes?: number;
  warningBytes: number;
  minimumBytes: number;
  checkedAt: string;
  cleanupAttempted?: boolean;
  cleanupFreedBytes?: number;
  cleanupError?: string;
}

export interface StorageCleanupSummary {
  freedBytes: number;
}

export interface StorageCapacityDependencies {
  /** Return the least available space across storage paths, or null if it cannot be measured. */
  measureAvailableBytes: () => number | null;
  /** Boolean indicates whether shared npm cache pruning is safe (no active runs). */
  cleanup: (pruneNpmCache: boolean) => Promise<StorageCleanupSummary>;
  hasActiveRuns: () => boolean;
  now?: () => number;
}

export interface StorageCapacityErrorOptions {
  code: 'insufficient_storage' | 'storage_capacity_unknown' | 'disk_full';
  statusCode: 507 | 503;
  availableBytes?: number;
  warningBytes: number;
  minimumBytes: number;
  cleanupAttempted: boolean;
  cleanupFreedBytes?: number;
  cleanupError?: string;
}

export class StorageCapacityError extends Error {
  readonly code: StorageCapacityErrorOptions['code'];
  readonly statusCode: StorageCapacityErrorOptions['statusCode'];
  readonly availableBytes?: number;
  readonly warningBytes: number;
  readonly minimumBytes: number;
  readonly cleanupAttempted: boolean;
  readonly cleanupFreedBytes?: number;
  readonly cleanupError?: string;
  readonly remediation: string;

  constructor(options: StorageCapacityErrorOptions) {
    super(options.code === 'storage_capacity_unknown'
      ? 'Available storage could not be measured; the API is refusing new runs to avoid a failed run.'
      : options.code === 'disk_full'
        ? 'The host filesystem is full or its storage quota has been reached.'
        : `Available storage remains below the ${formatBytes(options.minimumBytes)} minimum after cleanup.`);
    this.name = 'StorageCapacityError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.availableBytes = options.availableBytes;
    this.warningBytes = options.warningBytes;
    this.minimumBytes = options.minimumBytes;
    this.cleanupAttempted = options.cleanupAttempted;
    this.cleanupFreedBytes = options.cleanupFreedBytes;
    this.cleanupError = options.cleanupError;
    this.remediation = options.code === 'storage_capacity_unknown'
      ? 'Check that the /agents and cache mounts are available and that the API container can read filesystem capacity; then retry.'
      : 'Remove unrelated files or increase the host volume, then retry. Retained run artifacts and the dependency cache are preserved.';
  }
}

/** Coordinates low-space cleanup and admission without interrupting active jobs. */
export class StorageCapacityManager {
  private readonly warningBytes: number;
  private readonly minimumBytes: number;
  private readonly dependencies: StorageCapacityDependencies;
  private lastCleanupAt = 0;
  private cleanupPromise?: Promise<StorageCleanupSummary>;

  constructor(config: KasekiApiConfig, dependencies?: Partial<StorageCapacityDependencies>) {
    this.warningBytes = config.storageWarnFreeBytes ?? 5 * 1024 ** 3;
    this.minimumBytes = config.storageMinFreeBytes ?? 2 * 1024 ** 3;
    this.dependencies = {
      measureAvailableBytes: dependencies?.measureAvailableBytes ?? (() => measureStorageCapacity(config)),
      cleanup: dependencies?.cleanup ?? (async () => ({ freedBytes: 0 })),
      hasActiveRuns: dependencies?.hasActiveRuns ?? (() => false),
      now: dependencies?.now ?? Date.now,
    };
  }

  /** Inspect capacity without performing maintenance, for preflight and readiness. */
  getStatus(): StorageCapacityStatus {
    return this.statusFromAvailable(this.readAvailableBytes());
  }

  /** Prune safely below the warning threshold, then block new work below the minimum. */
  async ensureCapacity(): Promise<StorageCapacityStatus> {
    let availableBytes = this.readAvailableBytes();
    let cleanupAttempted = false;
    let cleanupFreedBytes = 0;
    let cleanupError: string | undefined;

    if (availableBytes !== null && availableBytes < this.warningBytes) {
      const now = this.dependencies.now!();
      if (this.cleanupPromise || availableBytes < this.minimumBytes || now - this.lastCleanupAt >= CLEANUP_COOLDOWN_MS) {
        cleanupAttempted = true;
        if (!this.cleanupPromise) this.lastCleanupAt = now;
        try {
          const cleanup = await this.runCleanup();
          cleanupFreedBytes = cleanup.freedBytes;
        } catch (error) {
          cleanupError = error instanceof Error ? error.message : String(error);
        }
        availableBytes = this.readAvailableBytes();
      }
    }

    const status = this.statusFromAvailable(availableBytes, {
      cleanupAttempted,
      cleanupFreedBytes,
      cleanupError,
    });
    if (availableBytes === null) {
      throw this.toError(status, 'storage_capacity_unknown');
    }
    if (availableBytes < this.minimumBytes) {
      throw this.toError(status, 'insufficient_storage');
    }
    return status;
  }

  private readAvailableBytes(): number | null {
    try {
      const availableBytes = this.dependencies.measureAvailableBytes();
      if (availableBytes === null || !Number.isFinite(availableBytes) || availableBytes < 0) return null;
      return Math.floor(availableBytes);
    } catch {
      return null;
    }
  }

  private async runCleanup(): Promise<StorageCleanupSummary> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = Promise.resolve()
        .then(() => this.dependencies.cleanup(!this.dependencies.hasActiveRuns()))
        .finally(() => { this.cleanupPromise = undefined; });
    }
    return this.cleanupPromise;
  }

  private statusFromAvailable(
    availableBytes: number | null,
    cleanup: Pick<StorageCapacityStatus, 'cleanupAttempted' | 'cleanupFreedBytes' | 'cleanupError'> = {},
  ): StorageCapacityStatus {
    const state: StorageCapacityState = availableBytes === null
      ? 'unknown'
      : availableBytes < this.minimumBytes
        ? 'blocked'
        : availableBytes < this.warningBytes
          ? 'warning'
          : 'ok';
    metricsRegistry.setStorageCapacity(availableBytes, this.warningBytes, this.minimumBytes);
    return {
      state,
      ...(availableBytes === null ? {} : { availableBytes }),
      warningBytes: this.warningBytes,
      minimumBytes: this.minimumBytes,
      checkedAt: new Date(this.dependencies.now!()).toISOString(),
      ...cleanup,
    };
  }

  private toError(
    status: StorageCapacityStatus,
    code: 'insufficient_storage' | 'storage_capacity_unknown',
  ): StorageCapacityError {
    return new StorageCapacityError({
      code,
      statusCode: code === 'insufficient_storage' ? 507 : 503,
      availableBytes: status.availableBytes,
      warningBytes: status.warningBytes,
      minimumBytes: status.minimumBytes,
      cleanupAttempted: status.cleanupAttempted ?? false,
      cleanupFreedBytes: status.cleanupFreedBytes,
      cleanupError: status.cleanupError,
    });
  }
}

/** Measure the least free space on all persistent paths the controller/worker writes to. */
export function measureStorageCapacity(config: KasekiApiConfig): number {
  const root = process.env.KASEKI_ROOT || '/agents';
  const paths = [
    config.resultsDir,
    config.runsDir || path.join(root, 'kaseki-runs'),
    config.hostCacheDir || process.env.KASEKI_HOST_CACHE_DIR || path.join(root, 'kaseki-cache'),
    config.npmCacheDir || path.join(config.hostCacheDir || path.join(root, 'kaseki-cache'), 'npm-cache'),
  ];
  let minimum: number | undefined;
  for (const storagePath of new Set(paths)) {
    const stat = fs.statfsSync(findExistingAncestor(storagePath));
    const available = Math.floor(stat.bavail * stat.bsize);
    minimum = minimum === undefined ? available : Math.min(minimum, available);
  }
  if (minimum === undefined) throw new Error('No persistent storage paths were configured');
  return minimum;
}

function findExistingAncestor(candidate: string): string {
  let current = path.resolve(candidate);
  while (true) {
    try {
      fs.accessSync(current, fs.constants.F_OK);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

/** Convert ENOSPC/EDQUOT failures from later filesystem writes to a stable API error. */
export function getStorageCapacityError(error: unknown): StorageCapacityError | undefined {
  if (error instanceof StorageCapacityError) return error;
  const code = findErrorCode(error);
  if (code !== 'ENOSPC' && code !== 'EDQUOT') return undefined;
  return new StorageCapacityError({
    code: 'disk_full',
    statusCode: 507,
    warningBytes: 5 * 1024 ** 3,
    minimumBytes: 2 * 1024 ** 3,
    cleanupAttempted: false,
  });
}

function findErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || depth > 3 || typeof error !== 'object') return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  return findErrorCode(candidate.cause, depth + 1);
}

export function storageErrorFields(error: StorageCapacityError): Record<string, unknown> {
  return {
    code: error.code,
    ...(error.availableBytes === undefined ? {} : { availableBytes: error.availableBytes }),
    warningBytes: error.warningBytes,
    minimumBytes: error.minimumBytes,
    cleanupAttempted: error.cleanupAttempted,
    ...(error.cleanupFreedBytes === undefined ? {} : { cleanupFreedBytes: error.cleanupFreedBytes }),
    ...(error.cleanupError === undefined ? {} : { cleanupError: error.cleanupError }),
    remediation: error.remediation,
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
