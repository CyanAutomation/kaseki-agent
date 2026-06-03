import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for documentation integrity and cross-references.
 */
describe('Documentation Integrity', () => {
  const projectRoot = process.cwd();

  it('keeps evaluation feedback-loop docs connected by exact headings and markdown link targets', () => {
    const docs = {
      goalSetting: {
        path: path.join(projectRoot, 'docs', 'GOAL_SETTING_GUIDE.md'),
        heading: '# Goal-Setting Agent Guide',
        requiredHeadings: [
          '## Why Goal-Setting?',
          '## How Goal-Setting Works',
        ],
        requiredLinks: [
          './EVALUATION_BEST_PRACTICES.md',
          './FEEDBACK_LOOP_INTEGRATION.md',
        ],
      },
      evaluationBestPractices: {
        path: path.join(projectRoot, 'docs', 'EVALUATION_BEST_PRACTICES.md'),
        heading: '# Evaluation Best Practices for Kaseki-Agent',
        requiredHeadings: [
          '## Part 1: Goal-Check Evaluation Best Practices',
          '## Part 2: Run-Evaluation Best Practices',
        ],
        requiredLinks: [
          'GOAL_SETTING_GUIDE.md',
          'FEEDBACK_LOOP_INTEGRATION.md',
        ],
      },
      feedbackLoop: {
        path: path.join(projectRoot, 'docs', 'FEEDBACK_LOOP_INTEGRATION.md'),
        heading: '# Feedback Loop Integration for Kaseki-Agent Evaluations',
        requiredHeadings: [
          '## Feedback Path 1: Goal Quality Scoring',
          '## Feedback Path 2: Kaseki Improvement Opportunities',
        ],
        requiredLinks: [
          './GOAL_SETTING_GUIDE.md',
          './EVALUATION_BEST_PRACTICES.md',
        ],
      },
    };

    Object.values(docs).forEach(({ path: docPath, heading, requiredHeadings, requiredLinks }) => {
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toContain(heading);

      requiredHeadings.forEach((requiredHeading) => {
        expect(content).toContain(requiredHeading);
      });

      requiredLinks.forEach((requiredLink) => {
        expect(content).toContain(`](${requiredLink})`);
      });
    });
  });
});
