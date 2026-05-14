import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('Build Artifacts Validation', () => {
  const projectRoot = path.join(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const distLibDir = path.join(distDir, 'lib');

  describe('dist/lib/ subdirectory structure', () => {
    it('should have dist/lib directory', () => {
      expect(fs.existsSync(distLibDir)).toBe(true);
      const stats = fs.statSync(distLibDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should have subprocess-helpers.js in dist/lib/', () => {
      const filePath = path.join(distLibDir, 'subprocess-helpers.js');
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should have TypeScript declaration files (.d.ts) in dist/lib/', () => {
      const dtsFiles = fs.readdirSync(distLibDir).filter((f) => f.endsWith('.d.ts'));
      expect(dtsFiles.length).toBeGreaterThan(0);
      expect(dtsFiles).toContain('event-timestamp-helpers.d.ts');
      expect(dtsFiles).toContain('subprocess-helpers.d.ts');
    });
  });

  describe('Module imports in compiled output', () => {
    it('pi-event-filter should preserve an importable event timestamp helper contract', () => {
      const sourcePath = path.join(projectRoot, 'src', 'pi-event-filter.ts');
      const sourceContent = fs.readFileSync(sourcePath, 'utf8');
      expect(sourceContent).toMatch(/from\s+['"]\.\/lib\/event-timestamp-helpers\.js['"]/);

      const compiledPath = path.join(distDir, 'pi-event-filter.js');
      const compiledContent = fs.readFileSync(compiledPath, 'utf8');
      expect(compiledContent).toMatch(/from\s+['"]\.\/lib\/event-timestamp-helpers\.js['"]|require\(['"]\.\/lib\/event-timestamp-helpers\.js['"]\)/);

      const helperPath = path.join(distLibDir, 'event-timestamp-helpers.js');
      const helperImportUrl = pathToFileURL(helperPath).href;
      try {
        execFileSync(process.execPath, [
          '--input-type=module',
          '--eval',
          `const helper = await import(${JSON.stringify(helperImportUrl)});
           if (typeof helper.extractEventTimestamp !== 'function') {
             throw new Error('event timestamp helper did not export extractEventTimestamp');
           }`,
        ], { encoding: 'utf8' });
      } catch (error) {
        throw new Error(`Failed to import or validate event-timestamp-helpers: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    it('kaseki-api-routes.js should import from ./lib/subprocess-helpers', () => {
      const filePath = path.join(distDir, 'kaseki-api-routes.js');
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toMatch(/from\s+['"]\.\/lib\/subprocess-helpers|require\(['"]\.\/lib\/subprocess-helpers/);
    });

    it('job-scheduler.js should import from ./lib/subprocess-helpers', () => {
      const filePath = path.join(distDir, 'job-scheduler.js');
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toMatch(/from\s+['"]\.\/lib\/subprocess-helpers|require\(['"]\.\/lib\/subprocess-helpers/);
    });
  });

  describe('Module exports from lib/', () => {
    it('subprocess-helpers.js should export expected symbols', () => {
      const filePath = path.join(distLibDir, 'subprocess-helpers.js');
      const content = fs.readFileSync(filePath, 'utf8');
      // Verify exports for functions used by kaseki-api-routes and job-scheduler
      expect(content).toMatch(/export.*execDockerCommand|export.*execSubprocess|exports\.execDockerCommand|exports\.execSubprocess/);
    });
  });
});
