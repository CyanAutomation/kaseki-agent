/**
 * Build capability detector
 *
 * Provides high-level API for detecting and caching build capabilities
 * across kaseki run phases.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectBuildCapability as detectLanguageBuildCapability } from './language-detection';

export interface BuildCapabilityInfo {
  language: string | null;
  command: string | null;
  detected: boolean;
  detectedAt: number; // Timestamp
}

/**
 * Detect build capability with optional caching
 *
 * @param workspaceRoot - Root directory to scan
 * @param cacheDir - (Optional) Directory to cache results; disables caching if not provided
 * @returns Build capability info
 */
export function detectBuildCapabilityWithCache(
  workspaceRoot: string,
  cacheDir?: string,
): BuildCapabilityInfo {
  // Check cache first
  if (cacheDir) {
    const cachedInfo = loadBuildCapabilityCache(cacheDir);
    if (cachedInfo) {
      return cachedInfo;
    }
  }

  // Detect
  const capability = detectLanguageBuildCapability(workspaceRoot);

  const info: BuildCapabilityInfo = {
    language: capability?.language ?? null,
    command: capability?.command ?? null,
    detected: capability !== null,
    detectedAt: Date.now(),
  };

  // Save cache
  if (cacheDir) {
    saveBuildCapabilityCache(cacheDir, info);
  }

  return info;
}

/**
 * Cache file path for build capability info
 */
function getBuildCapabilityCachePath(cacheDir: string): string {
  return path.join(cacheDir, '.build-capability-cache.json');
}

/**
 * Load build capability from cache (within 1 hour)
 */
function loadBuildCapabilityCache(cacheDir: string): BuildCapabilityInfo | null {
  const cachePath = getBuildCapabilityCachePath(cacheDir);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as BuildCapabilityInfo;
    // Cache valid for 1 hour
    const cacheAge = Date.now() - cached.detectedAt;
    if (cacheAge < 60 * 60 * 1000) {
      return cached;
    }
  } catch {
    // Ignore cache read errors; will detect fresh
  }

  return null;
}

/**
 * Save build capability to cache
 */
function saveBuildCapabilityCache(cacheDir: string, info: BuildCapabilityInfo): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = getBuildCapabilityCachePath(cacheDir);
    fs.writeFileSync(cachePath, JSON.stringify(info, null, 2), 'utf-8');
  } catch {
    // Silently ignore cache write failures
  }
}

/**
 * Clear build capability cache
 */
export function clearBuildCapabilityCache(cacheDir: string): void {
  try {
    const cachePath = getBuildCapabilityCachePath(cacheDir);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // Ignore errors
  }
}
