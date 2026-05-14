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

    it('subprocess helper consumers should resolve and import the emitted helper path', () => {
      const consumers = [
        {
          sourceFile: 'kaseki-api-routes.ts',
          distFile: 'kaseki-api-routes.js',
          importPattern: /import\s+\{\s*execDockerCommand\s*\}\s+from\s+['"]\.\/lib\/subprocess-helpers['"]/,
        },
        {
          sourceFile: 'job-scheduler.ts',
          distFile: 'job-scheduler.js',
          importPattern: /import\s+\{\s*execSubprocess\s*\}\s+from\s+['"]\.\/lib\/subprocess-helpers['"]/,
        },
      ];

      for (const { sourceFile, distFile, importPattern } of consumers) {
        const sourcePath = path.join(projectRoot, 'src', sourceFile);
        const sourceContent = fs.readFileSync(sourcePath, 'utf8');
        expect(sourceContent).toMatch(importPattern);

        const compiledPath = path.join(distDir, distFile);
        const compiledContent = fs.readFileSync(compiledPath, 'utf8');
        expect(compiledContent).toMatch(/from\s+['"]\.\/lib\/subprocess-helpers\.js['"]|require\(['"]\.\/lib\/subprocess-helpers\.js['"]\)/);
      }

      const helperPath = path.join(distLibDir, 'subprocess-helpers.js');
      const helperImportUrl = pathToFileURL(helperPath).href;
      const consumerImportUrls = consumers.map(({ distFile }) => pathToFileURL(path.join(distDir, distFile)).href);

      try {
        execFileSync(process.execPath, [
          '--input-type=module',
          '--eval',
          `const helper = await import(${JSON.stringify(helperImportUrl)});
           if (typeof helper.execDockerCommand !== 'function') {
             throw new Error('subprocess helper did not export execDockerCommand');
           }
           if (typeof helper.execSubprocess !== 'function') {
             throw new Error('subprocess helper did not export execSubprocess');
           }
           for (const consumerUrl of ${JSON.stringify(consumerImportUrls)}) {
             await import(consumerUrl);
           }`,
        ], { encoding: 'utf8' });
      } catch (error) {
        throw new Error(`Failed to import subprocess helper consumers: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
});
