#!/usr/bin/env node
/**
 * Validate Module Imports for Kaseki Agent
 *
 * This script ensures that all binaries compiled from TypeScript source files
 * can resolve their dependencies at runtime. It:
 * 1. Scans critical binaries (pi-progress-stream, pi-event-filter, kaseki-report, github-app-token)
 * 2. Parses their imports and builds a dependency graph
 * 3. Verifies all imports resolve to actual files in dist/
 * 4. Detects missing modules that should be copied to /app/lib/
 * 5. Reports any issues and fails if validation errors are found
 *
 * Exit codes:
 *   0 = All validations passed
 *   1 = Missing module dependencies detected
 */
export {};
//# sourceMappingURL=validate-module-imports.d.ts.map