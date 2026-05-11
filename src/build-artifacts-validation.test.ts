import fs from 'node:fs';
import path from 'node:path';

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

    it('should have event-timestamp-helpers.js in dist/lib/', () => {
      const filePath = path.join(distLibDir, 'event-timestamp-helpers.js');
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.length).toBeGreaterThan(0);
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
    it('pi-event-filter.js should import from ./lib/event-timestamp-helpers.js', () => {
      const filePath = path.join(distDir, 'pi-event-filter.js');
      const content = fs.readFileSync(filePath, 'utf8');
      // Verify the import statement is preserved in the compiled output
      expect(content).toMatch(/from\s+['"]\.\/lib\/event-timestamp-helpers\.js['"]|require\(['"]\.\/lib\/event-timestamp-helpers\.js['"]\)/);
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
    it('event-timestamp-helpers.js should export expected symbols', () => {
      const filePath = path.join(distLibDir, 'event-timestamp-helpers.js');
      const content = fs.readFileSync(filePath, 'utf8');
      // Verify exports for functions used by pi-event-filter
      expect(content).toMatch(/export.*extractEventTimestamp|exports\.extractEventTimestamp/);
    });

    it('subprocess-helpers.js should export expected symbols', () => {
      const filePath = path.join(distLibDir, 'subprocess-helpers.js');
      const content = fs.readFileSync(filePath, 'utf8');
      // Verify exports for functions used by kaseki-api-routes and job-scheduler
      expect(content).toMatch(/export.*execDockerCommand|export.*execSubprocess|exports\.execDockerCommand|exports\.execSubprocess/);
    });
  });
});
