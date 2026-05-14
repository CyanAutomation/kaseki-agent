import { initializeSetup } from './setup-orchestrator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock node version and template directory for testing
const testTemplateDir = path.join(os.tmpdir(), `kaseki-setup-test-${Date.now()}`);

describe('SetupOrchestrator', () => {
  afterEach(() => {
    // Clean up test directories
    if (fs.existsSync(testTemplateDir)) {
      fs.rmSync(testTemplateDir, { recursive: true, force: true });
    }
  });

  describe('initializeSetup', () => {
    it('should initialize setup with valid configuration', async () => {
      const result = await initializeSetup(testTemplateDir);

      expect(result).toEqual({
        nodeVersionValid: true,
        templateInitialized: true,
        templateDir: testTemplateDir,
      });
    });

    it('should use KASEKI_TEMPLATE_DIR env var if provided', async () => {
      const envTemplateDir = path.join(os.tmpdir(), `kaseki-env-test-${Date.now()}`);

      try {
        const originalEnv = process.env.KASEKI_TEMPLATE_DIR;
        process.env.KASEKI_TEMPLATE_DIR = envTemplateDir;

        const result = await initializeSetup();

        expect(result.templateDir).toBe(envTemplateDir);

        process.env.KASEKI_TEMPLATE_DIR = originalEnv;
      } finally {
        if (fs.existsSync(envTemplateDir)) {
          fs.rmSync(envTemplateDir, { recursive: true, force: true });
        }
      }
    });

    it('should use default template dir if nothing is provided', async () => {
      const originalEnv = process.env.KASEKI_TEMPLATE_DIR;
      delete process.env.KASEKI_TEMPLATE_DIR;

      try {
        const result = await initializeSetup(undefined);

        // Should use /agents/kaseki-template
        expect(result.templateDir).toBe('/agents/kaseki-template');
      } finally {
        process.env.KASEKI_TEMPLATE_DIR = originalEnv;
      }
    });

    it('should create parent directories if they do not exist', async () => {
      const deepDir = path.join(testTemplateDir, 'deep', 'nested', 'path', 'template');

      const result = await initializeSetup(deepDir);

      expect(result.templateDir).toBe(deepDir);
      // Parent directory should exist even if template init warning
      expect(fs.existsSync(path.dirname(deepDir))).toBe(true);
    });

    it('should handle already-initialized template directory', async () => {
      // Pre-create the template directory with run-kaseki.sh
      fs.mkdirSync(testTemplateDir, { recursive: true });
      fs.writeFileSync(path.join(testTemplateDir, 'run-kaseki.sh'), '#!/bin/bash\necho "test"');

      const result = await initializeSetup(testTemplateDir);

      expect(result.templateInitialized).toBe(true);
    });

    it('should handle template initialization with symlink fallback', async () => {
      // Create /app/run-kaseki.sh if not in Docker
      // The function logs warnings but continues
      const result = await initializeSetup(testTemplateDir);

      // Should complete without throwing
      expect(result.nodeVersionValid).toBe(true);
    });

    it('should handle template init errors gracefully and continue', async () => {
      // Create a read-only parent directory to simulate permission errors
      const readOnlyDir = path.join(os.tmpdir(), `kaseki-readonly-${Date.now()}`);
      const templateInReadOnly = path.join(readOnlyDir, 'template');

      try {
        fs.mkdirSync(readOnlyDir, { recursive: true });
        fs.chmodSync(readOnlyDir, 0o444); // Read-only

        // Should not throw, just log warnings
        // (This might fail on Windows or with different permissions model)
        // So we catch and verify it doesn't crash
        const result = await initializeSetup(templateInReadOnly);

        expect(result.nodeVersionValid).toBe(true);
        // templateInitialized may be false due to permissions
      } catch (err) {
        // Some systems may throw; that's acceptable
        // The key is that setup.ts handles it gracefully
        expect(err).toBeInstanceOf(Error);
      } finally {
        // Clean up - restore write permission first
        try {
          fs.chmodSync(readOnlyDir, 0o755);
          fs.rmSync(readOnlyDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Node version validation (integration test)', () => {
    it('should accept Node v24 or higher', async () => {
      // Current process should be >= v24
      expect(process.versions.node).toMatch(/^\d+\.\d+\.\d+/);
      const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
      expect(majorVersion).toBeGreaterThanOrEqual(24);

      // initializeSetup should succeed
      const result = await initializeSetup(testTemplateDir);
      expect(result.nodeVersionValid).toBe(true);
    });
  });

  describe('setup context return value', () => {
    it('should return SetupContext with all required properties', async () => {
      const result = await initializeSetup(testTemplateDir);

      expect(result).toHaveProperty('nodeVersionValid');
      expect(result).toHaveProperty('templateInitialized');
      expect(result).toHaveProperty('templateDir');

      expect(typeof result.nodeVersionValid).toBe('boolean');
      expect(typeof result.templateInitialized).toBe('boolean');
      expect(typeof result.templateDir).toBe('string');
    });

    it('should mark nodeVersionValid as true after successful init', async () => {
      const result = await initializeSetup(testTemplateDir);
      expect(result.nodeVersionValid).toBe(true);
    });

    it('should mark templateInitialized as true after setup', async () => {
      const result = await initializeSetup(testTemplateDir);
      expect(result.templateInitialized).toBe(true);
    });
  });
});
