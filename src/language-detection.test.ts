/**
 * Language detection tests
 * Tests detection of various programming languages and their build systems
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectLanguage,
  getBuildCommand,
  detectBuildCapability,
} from './language-detection';

describe('language-detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-lang-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript when tsconfig.json exists', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      const language = detectLanguage(tempDir);
      expect(language).toBe('typescript');
    });

    it('should detect TypeScript when typescript dependency exists', () => {
      const packageJson = {
        dependencies: { typescript: '^5.0.0' },
      };
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson),
      );
      const language = detectLanguage(tempDir);
      expect(language).toBe('typescript');
    });

    it('should detect Go when go.mod exists', () => {
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module example.com/test\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('go');
    });

    it('should detect Rust when Cargo.toml exists', () => {
      fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('rust');
    });

    it('should detect Java when build.gradle exists', () => {
      fs.writeFileSync(path.join(tempDir, 'build.gradle'), 'plugins {}\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('java');
    });

    it('should detect Java when pom.xml exists', () => {
      fs.writeFileSync(path.join(tempDir, 'pom.xml'), '<project>\n</project>\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('java');
    });

    it('should detect Python when setup.py exists', () => {
      fs.writeFileSync(path.join(tempDir, 'setup.py'), 'from setuptools import setup\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('python');
    });

    it('should detect Python when pyproject.toml exists', () => {
      fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), '[project]\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('python');
    });

    it('should return null when no language detected', () => {
      const language = detectLanguage(tempDir);
      expect(language).toBeNull();
    });

    it('should prioritize TypeScript over other languages when multiple exist', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test\n');
      const language = detectLanguage(tempDir);
      expect(language).toBe('typescript');
    });

    it('should handle missing directories gracefully', () => {
      const nonexistent = path.join(tempDir, 'nonexistent');
      const language = detectLanguage(nonexistent);
      expect(language).toBeNull();
    });

    it('should handle malformed package.json', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), 'invalid json {');
      const language = detectLanguage(tempDir);
      expect(language).toBeNull();
    });
  });

  describe('getBuildCommand', () => {
    it('should return npm run build for TypeScript with npm', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      const packageJson = {
        scripts: { build: 'tsc' },
      };
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson),
      );
      const command = getBuildCommand(tempDir, 'typescript');
      expect(command).toBe('npm run build');
    });

    it('should return npm run build for TypeScript without explicit build script', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({}),
      );
      const command = getBuildCommand(tempDir, 'typescript');
      expect(command).toBe('npm run build');
    });

    it('should return go build for Go', () => {
      const command = getBuildCommand(tempDir, 'go');
      expect(command).toBe('go build');
    });

    it('should return cargo build for Rust', () => {
      const command = getBuildCommand(tempDir, 'rust');
      expect(command).toBe('cargo build');
    });

    it('should return gradle build for Java with Gradle', () => {
      const command = getBuildCommand(tempDir, 'java', 'gradle');
      expect(command).toBe('gradle build');
    });

    it('should return mvn clean install for Java with Maven', () => {
      const command = getBuildCommand(tempDir, 'java', 'maven');
      expect(command).toBe('mvn clean install');
    });

    it('should return python -m build for Python', () => {
      const command = getBuildCommand(tempDir, 'python');
      expect(command).toBe('python -m build');
    });

    it('should return null for unknown language', () => {
      const command = getBuildCommand(tempDir, 'unknown' as any);
      expect(command).toBeNull();
    });
  });

  describe('detectBuildCapability', () => {
    it('should return complete capability for TypeScript project', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'tsc' } }),
      );

      const capability = detectBuildCapability(tempDir);

      expect(capability).not.toBeNull();
      expect(capability!.language).toBe('typescript');
      expect(capability!.command).toBe('npm run build');
      expect(capability!.detected).toBe(true);
    });

    it('should return complete capability for Go project', () => {
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test\n');

      const capability = detectBuildCapability(tempDir);

      expect(capability).not.toBeNull();
      expect(capability!.language).toBe('go');
      expect(capability!.command).toBe('go build');
      expect(capability!.detected).toBe(true);
    });

    it('should return complete capability for Rust project', () => {
      fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\n');

      const capability = detectBuildCapability(tempDir);

      expect(capability).not.toBeNull();
      expect(capability!.language).toBe('rust');
      expect(capability!.command).toBe('cargo build');
      expect(capability!.detected).toBe(true);
    });

    it('should return null when no build capability detected', () => {
      const capability = detectBuildCapability(tempDir);
      expect(capability).toBeNull();
    });

    it('should handle edge case: Java with both Gradle and Maven', () => {
      fs.writeFileSync(path.join(tempDir, 'build.gradle'), 'plugins {}\n');
      fs.writeFileSync(path.join(tempDir, 'pom.xml'), '<project></project>\n');

      const capability = detectBuildCapability(tempDir);

      // Should prefer Gradle (checked first)
      expect(capability).not.toBeNull();
      expect(capability!.language).toBe('java');
      expect(capability!.command).toBe('gradle build');
    });

    it('should detect nested tsconfig.json in subdirectories', () => {
      const subdir = path.join(tempDir, 'backend');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'tsconfig.json'), '{}');
      // Should not find nested config from parent
      const capability = detectBuildCapability(tempDir);
      expect(capability).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('should handle mixed TypeScript + Go monorepo (from root)', () => {
      // Create TS config at root
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      // Create Go module in subdirectory
      const goDir = path.join(tempDir, 'go-service');
      fs.mkdirSync(goDir);
      fs.writeFileSync(path.join(goDir, 'go.mod'), 'module test\n');

      // Root should detect TS
      const rootCapability = detectBuildCapability(tempDir);
      expect(rootCapability!.language).toBe('typescript');

      // Subdirectory should detect Go
      const goCapability = detectBuildCapability(goDir);
      expect(goCapability!.language).toBe('go');
    });

    it('should return consistent structure across all languages', () => {
      const testCases: Array<[string, string, string]> = [
        [
          'tsconfig.json',
          JSON.stringify({ scripts: { build: 'tsc' } }),
          'package.json',
        ],
        ['go.mod', 'module test\n', ''],
        ['Cargo.toml', '[package]\n', ''],
        ['build.gradle', 'plugins {}\n', ''],
      ];

      for (const [file, content, packageFile] of testCases) {
        // Clean temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir);

        fs.writeFileSync(path.join(tempDir, file), content);
        if (packageFile) {
          fs.writeFileSync(path.join(tempDir, packageFile), JSON.stringify({}));
        }

        const capability = detectBuildCapability(tempDir);

        expect(capability).not.toBeNull();
        expect(capability).toHaveProperty('language');
        expect(capability).toHaveProperty('command');
        expect(capability).toHaveProperty('detected');
        expect(typeof capability!.language).toBe('string');
        expect(typeof capability!.command).toBe('string');
        expect(capability!.detected).toBe(true);
      }
    });
  });
});
