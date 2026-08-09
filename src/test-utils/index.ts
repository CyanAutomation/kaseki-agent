/**
 * Test utilities for kaseki-agent test suite
 *
 * Provides optimized helpers for:
 * - Creating fake binary stubs for testing
 * - Creating and initializing fake git repositories
 * - Managing temporary directories with lifecycle support
 */

export * from './fake-binaries';
export * from './fake-git-repo';

// Note: bash-script-cache and orchestration-stub removed (dead code)
