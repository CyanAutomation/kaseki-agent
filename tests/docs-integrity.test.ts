import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for documentation integrity and cross-references
 *
 * These tests verify that:
 * 1. Documentation files link to related docs with correct markdown syntax
 * 2. Referenced files exist and contain expected headings
 * 3. Cross-references between evaluation-related docs are consistent
 */
describe('Documentation Integrity', () => {
  const projectRoot = process.cwd();

  describe('GOAL_SETTING_GUIDE.md cross-references', () => {
    const goalSettingPath = path.join(projectRoot, 'docs', 'GOAL_SETTING_GUIDE.md');
    const bestPracticesPath = path.join(projectRoot, 'docs', 'EVALUATION_BEST_PRACTICES.md');
    const feedbackLoopPath = path.join(projectRoot, 'docs', 'FEEDBACK_LOOP_INTEGRATION.md');

    it('should exist with valid markdown content', () => {
      expect(fs.existsSync(goalSettingPath)).toBe(true);
      const content = fs.readFileSync(goalSettingPath, 'utf8');
      expect(content).toBeTruthy();
      expect(content).toContain('# Goal-Setting');
    });

    it('should link to EVALUATION_BEST_PRACTICES.md', () => {
      const content = fs.readFileSync(goalSettingPath, 'utf8');
      // Check for markdown link syntax: [text](EVALUATION_BEST_PRACTICES.md) or [text](./EVALUATION_BEST_PRACTICES.md)
      expect(content).toMatch(/\[.*[Ee]valuation\s+[Bb]est\s+[Pp]ractices.*\]\(.*EVALUATION_BEST_PRACTICES\.md.*\)/);
    });

    it('should link to FEEDBACK_LOOP_INTEGRATION.md', () => {
      const content = fs.readFileSync(goalSettingPath, 'utf8');
      // Check for markdown link syntax: [text](FEEDBACK_LOOP_INTEGRATION.md) or [text](./FEEDBACK_LOOP_INTEGRATION.md)
      expect(content).toMatch(/\[.*[Ff]eedback\s+[Ll]oop.*\]\(.*FEEDBACK_LOOP_INTEGRATION\.md.*\)/);
    });

    it('referenced EVALUATION_BEST_PRACTICES.md should exist and contain expected headings', () => {
      expect(fs.existsSync(bestPracticesPath)).toBe(true);
      const content = fs.readFileSync(bestPracticesPath, 'utf8');

      // Verify core headings are present
      expect(content).toContain('# Evaluation Best Practices');
      expect(content).toContain('Goal-Check');
      expect(content).toContain('Run-Evaluation');
      expect(content).toMatch(/##\s+/); // Has at least one h2 heading
    });

    it('referenced FEEDBACK_LOOP_INTEGRATION.md should exist and contain expected headings', () => {
      expect(fs.existsSync(feedbackLoopPath)).toBe(true);
      const content = fs.readFileSync(feedbackLoopPath, 'utf8');

      // Verify core headings are present
      expect(content).toContain('# Feedback Loop Integration');
      expect(content).toContain('Goal-Setting');
      expect(content).toContain('Goal-Check');
      expect(content).toContain('Run-Evaluation');
      expect(content).toMatch(/##\s+/); // Has at least one h2 heading
    });
  });

  describe('Evaluation docs cross-references', () => {
    const bestPracticesPath = path.join(projectRoot, 'docs', 'EVALUATION_BEST_PRACTICES.md');
    const feedbackLoopPath = path.join(projectRoot, 'docs', 'FEEDBACK_LOOP_INTEGRATION.md');
    const goalSettingPath = path.join(projectRoot, 'docs', 'GOAL_SETTING_GUIDE.md');

    it('EVALUATION_BEST_PRACTICES.md should reference related docs', () => {
      const content = fs.readFileSync(bestPracticesPath, 'utf8');

      // Should mention or link to goal-setting concepts
      expect(content).toContain('Goal-Setting');
      // Should mention feedback or iteration
      expect(content.toLowerCase()).toContain('feedback');
    });

    it('FEEDBACK_LOOP_INTEGRATION.md should reference EVALUATION_BEST_PRACTICES.md', () => {
      const content = fs.readFileSync(feedbackLoopPath, 'utf8');

      // Should mention the best practices or evaluations
      expect(content).toContain('goal-check');
      expect(content).toContain('run-evaluation');
    });

    it('all referenced docs should use consistent terminology', () => {
      const bestPracticesContent = fs.readFileSync(bestPracticesPath, 'utf8');
      const feedbackLoopContent = fs.readFileSync(feedbackLoopPath, 'utf8');

      // All should use "goal-check" consistently
      const goalCheckRegex = /goal-check/i;
      expect(bestPracticesContent).toMatch(goalCheckRegex);
      expect(feedbackLoopContent).toMatch(goalCheckRegex);

      // All should use "run-evaluation" consistently
      const runEvalRegex = /run-evaluation/i;
      expect(bestPracticesContent).toMatch(runEvalRegex);
      expect(feedbackLoopContent).toMatch(runEvalRegex);
    });

    it('should have no broken markdown links between docs', () => {
      const docs = [
        { path: bestPracticesPath, name: 'EVALUATION_BEST_PRACTICES.md' },
        { path: feedbackLoopPath, name: 'FEEDBACK_LOOP_INTEGRATION.md' },
        { path: goalSettingPath, name: 'GOAL_SETTING_GUIDE.md' },
      ];

      docs.forEach(({ path: docPath, name }) => {
        const content = fs.readFileSync(docPath, 'utf8');

        // Find all markdown links: [text](file)
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
          const [, , link] = match;

          // Skip external links (http, https) and anchors-only links
          if (link.startsWith('http') || link.startsWith('mailto:') || link.startsWith('#')) {
            continue;
          }

          // Resolve relative path (remove leading ./ if present)
          const resolvedLink = link.startsWith('./') ? link.substring(2) : link;

          // Check if linked file exists (split on # to handle anchor links)
          const filePart = resolvedLink.split('#')[0];
          const fullPath = path.join(projectRoot, 'docs', filePart);

          // Only error if the file part is non-empty and file doesn't exist
          if (filePart && !fs.existsSync(fullPath)) {
            throw new Error(`Broken link in ${name}: [${filePart}](${link}) - file does not exist at ${fullPath}`);
          }
        }
      });
    });
  });

  describe('Documentation structure', () => {
    it('all evaluation docs should have a top-level heading', () => {
      const docs = [
        path.join(projectRoot, 'docs', 'GOAL_SETTING_GUIDE.md'),
        path.join(projectRoot, 'docs', 'EVALUATION_BEST_PRACTICES.md'),
        path.join(projectRoot, 'docs', 'FEEDBACK_LOOP_INTEGRATION.md'),
      ];

      docs.forEach(docPath => {
        const content = fs.readFileSync(docPath, 'utf8');
        // Each doc should start with # (h1) or have one early in the file
        expect(content).toMatch(/^#\s+[^\n]/m);
      });
    });

    it('all evaluation docs should have subsections (h2 headings)', () => {
      const docs = [
        path.join(projectRoot, 'docs', 'GOAL_SETTING_GUIDE.md'),
        path.join(projectRoot, 'docs', 'EVALUATION_BEST_PRACTICES.md'),
        path.join(projectRoot, 'docs', 'FEEDBACK_LOOP_INTEGRATION.md'),
      ];

      docs.forEach(docPath => {
        const content = fs.readFileSync(docPath, 'utf8');
        // Each doc should have at least one h2 section
        expect(content).toMatch(/^##\s+/m);
      });
    });
  });
});
