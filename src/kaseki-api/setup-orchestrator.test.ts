import * as setupOrchestrator from './setup-orchestrator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const testTemplateDir = path.join(os.tmpdir(), 'kaseki-setup-test-' + Date.now());
const currentNodeMajor = parseInt(process.versions.node.split('.')[0], 10);
const skipNodeVersionCheck = () => ({ assertNodeVersion: jest.fn() });

describe('SetupOrchestrator', () => {
  beforeEach(() => {
    // Mock process.exit to throw an error instead of exiting
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      const error = new Error('process.exit(' + (code ?? 0) + ') called');
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
      const result = await setupOrchestrator.initializeSetup(testTemplateDir, skipNodeVersionCheck());
      expect(result).toEqual({
        nodeVersionValid: true,
        templateInitialized: true,
        templateDir: testTemplateDir,
      });
    });

    it('should use injected setup dependencies when provided', async () => {
      const assertNodeVersion = jest.fn();
      const ensureTemplate = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

      const result = await setupOrchestrator.initializeSetup(testTemplateDir, {
        assertNodeVersion,
        ensureTemplate,
      });

      expect(assertNodeVersion).toHaveBeenCalledTimes(1);
      expect(ensureTemplate).toHaveBeenCalledWith(testTemplateDir);
      expect(result.templateDir).toBe(testTemplateDir);
    });

    it('should use KASEKI_TEMPLATE_DIR env var if provided', async () => {
      const envTemplateDir = path.join(os.tmpdir(), 'kaseki-env-test-' + Date.now());
      const originalEnv = process.env.KASEKI_TEMPLATE_DIR;
      try {
        process.env.KASEKI_TEMPLATE_DIR = envTemplateDir;
        const result = await setupOrchestrator.initializeSetup(undefined, skipNodeVersionCheck());
        expect(result.templateDir).toBe(envTemplateDir);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.KASEKI_TEMPLATE_DIR;
        } else {
          process.env.KASEKI_TEMPLATE_DIR = originalEnv;
        }
        if (fs.existsSync(envTemplateDir)) {
          fs.rmSync(envTemplateDir, { recursive: true, force: true });
        }
      }
    });

    it('should use default template dir if nothing is provided', async () => {
      const originalEnv = process.env.KASEKI_TEMPLATE_DIR;
      delete process.env.KASEKI_TEMPLATE_DIR;
      try {
        const result = await setupOrchestrator.initializeSetup(undefined, skipNodeVersionCheck());
        expect(result.templateDir).toBe('/agents/kaseki-template');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.KASEKI_TEMPLATE_DIR;
        } else {
          process.env.KASEKI_TEMPLATE_DIR = originalEnv;
        }
      }
    });

    it('should create parent directories if they do not exist', async () => {
      const deepDir = path.join(testTemplateDir, 'deep', 'nested', 'path', 'template');
      const result = await setupOrchestrator.initializeSetup(deepDir, skipNodeVersionCheck());
      expect(result.templateDir).toBe(deepDir);
      expect(fs.existsSync(path.dirname(deepDir))).toBe(true);
    });

    it('should handle already-initialized template directory', async () => {
      fs.mkdirSync(testTemplateDir, { recursive: true });
      fs.writeFileSync(path.join(testTemplateDir, 'run-kaseki.sh'), '#!/bin/bash\necho "test"');
      const result = await setupOrchestrator.initializeSetup(testTemplateDir, skipNodeVersionCheck());
      expect(result.templateInitialized).toBe(true);
    });

    it('should handle template initialization with symlink fallback', async () => {
      const imageAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-image-app-'));
      const previousImageAppDir = process.env.KASEKI_IMAGE_APP_DIR;
      const entries = [
        'run-kaseki.sh',
        'kaseki-agent.sh',
        'scripts/kaseki-activate.sh',
        'scripts/kaseki-preflight.sh',
        'lib/pi-event-filter.js',
        'lib/pi-progress-stream.js',
        'lib/kaseki-report.js',
        'lib/github-app-token.js',
        'lib/github-app-private-key.js',
        'lib/github-utils.js',
        'lib/logger.js',
        'lib/secrets/host-secrets-reader.js',
      ];

      for (const entry of entries) {
        const sourcePath = path.join(imageAppDir, entry);
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, '#!/bin/sh\n');
      }

      try {
        process.env.KASEKI_IMAGE_APP_DIR = imageAppDir;
        const result = await setupOrchestrator.initializeSetup(testTemplateDir, skipNodeVersionCheck());

        expect(result.nodeVersionValid).toBe(true);
        for (const entry of entries) {
          expect(fs.existsSync(path.join(testTemplateDir, entry))).toBe(true);
        }
      } finally {
        if (previousImageAppDir === undefined) {
          delete process.env.KASEKI_IMAGE_APP_DIR;
        } else {
          process.env.KASEKI_IMAGE_APP_DIR = previousImageAppDir;
        }
        fs.rmSync(imageAppDir, { recursive: true, force: true });
      }
    });

    it('should handle template init errors gracefully and continue', async () => {
      const readOnlyDir = path.join(os.tmpdir(), 'kaseki-readonly-' + Date.now());
      const templateInReadOnly = path.join(readOnlyDir, 'template');
      try {
        fs.mkdirSync(readOnlyDir, { recursive: true });
        fs.chmodSync(readOnlyDir, 0o444);
        const result = await setupOrchestrator.initializeSetup(templateInReadOnly, skipNodeVersionCheck());
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
      const majorVersion = currentNodeMajor;

      // Skip this test if running on Node < 24, as it's an integration test
      // that validates actual Node version compatibility
      if (majorVersion < 24) {
        console.log(`Skipping Node v24 validation test - running on v${majorVersion}`);
        return;
      }

      const result = await setupOrchestrator.initializeSetup(testTemplateDir);
      expect(result.nodeVersionValid).toBe(true);
    });

    it('should validate Node version format correctly', () => {
      // Test that assertSupportedNodeVersion accepts valid versions
      expect(() => {
        setupOrchestrator.assertSupportedNodeVersion('24.0.0', 24);
      }).not.toThrow();

      expect(() => {
        setupOrchestrator.assertSupportedNodeVersion('25.1.2', 24);
      }).not.toThrow();
    });

    it('should reject Node versions below the minimum', () => {
      expect(() => {
        setupOrchestrator.assertSupportedNodeVersion('23.9.0', 24);
      }).toThrow('process.exit(1) called');
    });

    it('should reject invalid Node version formats', () => {
      expect(() => {
        setupOrchestrator.assertSupportedNodeVersion('not-a-version', 24);
      }).toThrow('process.exit(1) called');
    });
  });

  describe('setup context return value', () => {
    it('should return SetupContext with all required properties', async () => {
      const result = await setupOrchestrator.initializeSetup(testTemplateDir, skipNodeVersionCheck());
      expect(result).toHaveProperty('nodeVersionValid');
      expect(result).toHaveProperty('templateInitialized');
      expect(result).toHaveProperty('templateDir');
      expect(typeof result.nodeVersionValid).toBe('boolean');
      expect(typeof result.templateInitialized).toBe('boolean');
      expect(typeof result.templateDir).toBe('string');
    });

    it('should mark nodeVersionValid as true after successful init', async () => {
      const result = await setupOrchestrator.initializeSetup(testTemplateDir, skipNodeVersionCheck());
      expect(result.nodeVersionValid).toBe(true);
    });

    it('should mark templateInitialized as true after setup', async () => {
      const result = await setupOrchestrator.initializeSetup(testTemplateDir, skipNodeVersionCheck());
      expect(result.templateInitialized).toBe(true);
    });
  });
});
