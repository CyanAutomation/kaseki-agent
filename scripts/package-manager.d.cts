export type PackageManager = 'npm' | 'bun';
export interface PackageManagerSelection {
  manager: PackageManager;
  lockfile: string;
  requestedVersion: string;
  workspaces: boolean;
  treeCacheSafe: boolean;
}
export function resolvePackageManager(manifest: unknown, files?: string[], requireLock?: boolean): PackageManagerSelection;
export function packageScriptCommand(manager: PackageManager, script: string): string;
export function dependencyInputHash(root: string, lockfile: string): string;
