import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('Build Artifacts Validation', () => {
  const projectRoot = path.join(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const distLibDir = path.join(distDir, 'lib');

  describe('compiled runtime imports', () => {
    it('assumes a built package and verifies real entry points resolve emitted helper imports', () => {
      const distStats = fs.statSync(distDir, {
        throwIfNoEntry: false,
      });
      expect(distStats?.isDirectory() ?? false).toBe(true);

      const distLibStats = fs.statSync(distLibDir, {
        throwIfNoEntry: false,
      });
      expect(distLibStats?.isDirectory() ?? false).toBe(true);

      const entryPoints = [
        {
          path: path.join(distDir, 'kaseki-api-routes.js'),
          exportName: 'createApiRouter',
        },
        {
          path: path.join(distDir, 'job-scheduler.js'),
          exportName: 'JobScheduler',
        },
      ];
      const helperExports = [
        {
          path: path.join(distLibDir, 'subprocess-helpers.js'),
          exportName: 'execDockerCommand',
        },
        {
          path: path.join(distLibDir, 'subprocess-helpers.js'),
          exportName: 'execSubprocess',
        },
      ];

      try {
        execFileSync(process.execPath, [
          '--input-type=module',
          '--eval',
          `const entryPoints = ${JSON.stringify(entryPoints.map(({ path: entryPath, exportName }) => ({
            url: pathToFileURL(entryPath).href,
            exportName,
          })))};
           const helperExports = ${JSON.stringify(helperExports.map(({ path: helperPath, exportName }) => ({
             url: pathToFileURL(helperPath).href,
             exportName,
           })))};
           for (const { url, exportName } of entryPoints) {
             const module = await import(url);
             if (typeof module[exportName] !== 'function') {
               throw new Error(\`entry point ${'${url}'} did not export ${'${exportName}'}\`);
             }
           }
           for (const { url, exportName } of helperExports) {
             const module = await import(url);
             if (typeof module[exportName] !== 'function') {
               throw new Error(\`helper ${'${url}'} did not export ${'${exportName}'}\`);
             }
           }`,
        ], { encoding: 'utf8' });
      } catch (error) {
        throw new Error(`Failed to validate built package runtime imports. Run npm run build before this smoke test. ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
});
