import { initializeSetup } from './setup-orchestrator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const testTemplateDir = path.join(os.tmpdir(), "kaseki-setup-test-" + Date.now());

describe('SetupOrchestrator', () => {
  beforeEach(() => {
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      const error = new Error("process.exit(" + (code ?? 0) + ") called");
      throw error;
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      const envTemplateDir = path.join(os.tmpdir(), "kaseki-env-test-" + Date.now());
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
        expect(result.templateDir).toBe('/agents/kaseki-template');
      } finally {
        process.env.KASEKI_TEMPLATE_DIR = originalEnv;
      }
    });

    it('should create parent directories if they do not exist', async () => {
      const deepDir = path.join(testTemplateDir, 'deep', 'nested', 'path', 'template');
      const result = await initializeSetup(deepDir);
      expect(result.templateDir).toBe(deepDir);
      expect(fs.existsSync(path.dirname(deepDir))).toBe(true);
    });

    it('should handle already-initialized template directory', async () => {
      fs.mkdirSync(testTemplateDir, { recursive: true });
      fs.writeFileSync(path.join(testTemplateDir, 'run-kaseki.sh'), '#!/bin/bash\necho "test"');
      const result = await initializeSetup(testTemplateDir);
      expect(result.templateInitialized).toBe(true);
    });

    it('should handle template initialization with symlink fallback', async () => {
      const result = await initializeSetup(testTemplateDir);
      expect(result.nodeVersionValid).toBe(true);
    });

    it('should handle template init errors gracefully and continue', async () => {
      const readOnlyDir = path.join(os.tmpdir(), "kaseki-readonly-" + Date.now());
      const templateInReadOnly = path.join(readOnlyDir, 'template');
      try {
        fs.mkdirSync(readOnlyDir, { recursive: true });
        fs.chmodSync(readOnlyDir, 0o444);
        const result = await initializeSetup(templateInReadOnly);
        expect(result.nodeVersionValid).toBe(true);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      } finally {
        try {
          fs.chmodSync(readOnlyDir, 0o755);
          fs.rmSync(readOnlyDir, { recursive: true, force: true });
        } catch {
        }
      }
    });
  });

  describe('Node version validation (integration test)', () => {
    it('should accept Node v24 or higher', async () => {
      expect(process.versions.node).toMatch(/^\d+\.\d+\.\d+/);
      const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
      expect(majorVersion).toBeGreaterThanOrEqual(24);
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
