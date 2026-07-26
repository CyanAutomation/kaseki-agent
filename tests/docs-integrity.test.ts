import * as fs from 'fs';
import * as path from 'path';
import {
  collectMarkdownAnchors,
  extractMarkdownLinks,
  isExternalMarkdownLink,
  splitMarkdownLink,
} from './helpers/markdown';

/**
 * Tests for documentation integrity.
 *
 * The general check validates that evaluation markdown docs do not contain
 * broken internal links or anchors. Evaluation-guide content checks are intentionally
 * limited to documented navigation contracts: stable cross-document links and a
 * small set of anchors that other docs or readers can reasonably depend on.
 */
describe('Documentation integrity', () => {
  const projectRoot = process.cwd();
  const docsDir = path.join(projectRoot, 'docs');

  type EvaluationDocContract = {
    fileName: string;
    requiredLinks?: string[];
    stableAnchors?: string[];
  };

  const evaluationDocContracts: EvaluationDocContract[] = [
    {
      fileName: 'GOAL_SETTING_GUIDE.md',
      requiredLinks: ['./EVALUATION_BEST_PRACTICES.md', './FEEDBACK_LOOP_INTEGRATION.md'],
      stableAnchors: [
        'goal-setting-agent-guide',
        'configuration',
        'test-updates-in-goals',
        'troubleshooting',
        'see-also',
      ],
    },
    {
      fileName: 'EVALUATION_BEST_PRACTICES.md',
      requiredLinks: ['GOAL_SETTING_GUIDE.md', 'FEEDBACK_LOOP_INTEGRATION.md'],
      stableAnchors: [
        'evaluation-best-practices-for-kaseki-agent',
        'part-1-goal-check-evaluation-best-practices',
        'part-2-run-evaluation-best-practices',
        'part-4-feedback-loop-integration',
        'references',
      ],
    },
    {
      fileName: 'FEEDBACK_LOOP_INTEGRATION.md',
      requiredLinks: ['../src/lib/goal-setting-feedback.ts', '../scripts/analyze-goal-feedback.ts'],
      stableAnchors: [
        'feedback-loop-integration-for-kaseki-agent-evaluations',
        'feedback-path-1-goal-quality-scoring',
        'feedback-path-2-kaseki-improvement-opportunities',
        'integration-points',
        'data-schema',
      ],
    },
  ];

  it('resolves internal markdown links and anchors in evaluation docs', () => {
    evaluationDocContracts.forEach(({ fileName }) => {
      const sourcePath = path.join(docsDir, fileName);
      const sourceContent = fs.readFileSync(sourcePath, 'utf8');
      const sourceDir = path.dirname(sourcePath);
      const sourceFile = path.relative(projectRoot, sourcePath);
      const sourceAnchors = collectMarkdownAnchors(sourceContent);

      extractMarkdownLinks(sourceContent, sourceFile).forEach(({ link }) => {
        if (isExternalMarkdownLink(link)) {
          return;
        }

        const { filePart, anchor } = splitMarkdownLink(link);
        const targetPath = filePart ? path.resolve(sourceDir, filePart) : sourcePath;

        expect(fs.existsSync(targetPath)).toBe(true);

        if (anchor) {
          const targetContent = targetPath === sourcePath
            ? sourceContent
            : fs.readFileSync(targetPath, 'utf8');
          const targetAnchors = targetPath === sourcePath ? sourceAnchors : collectMarkdownAnchors(targetContent);

          expect(targetAnchors).toContain(anchor);
        }
      });
    });
  });

  it('preserves documented evaluation-guide navigation contracts', () => {
    evaluationDocContracts.forEach(({ fileName, requiredLinks, stableAnchors }) => {
      const sourcePath = path.join(docsDir, fileName);

      expect(fs.existsSync(sourcePath)).toBe(true);

      const sourceContent = fs.readFileSync(sourcePath, 'utf8');
      const linkTargets = extractMarkdownLinks(sourceContent, fileName).map(({ link }) => link);
      const anchors = collectMarkdownAnchors(sourceContent);

      requiredLinks?.forEach((requiredLink) => {
        expect(linkTargets).toContain(requiredLink);
      });

      stableAnchors?.forEach((stableAnchor) => {
        expect(anchors).toContain(stableAnchor);
      });
    });
  });

  it('resolves every repository target in docs/INDEX.md without encoding corruption', () => {
    const sourcePath = path.join(docsDir, 'INDEX.md');
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    const failures: string[] = [];

    if (sourceContent.includes('\uFFFD')) {
      failures.push('docs/INDEX.md: contains a Unicode replacement character');
    }

    extractMarkdownLinks(sourceContent, 'docs/INDEX.md').forEach(({ link }) => {
      if (isExternalMarkdownLink(link)) return;

      const { filePart, anchor } = splitMarkdownLink(link);
      const targetPath = filePart ? path.resolve(docsDir, filePart) : sourcePath;
      if (!fs.existsSync(targetPath)) {
        failures.push(`docs/INDEX.md: missing target ${link}`);
        return;
      }

      if (anchor && fs.statSync(targetPath).isFile()) {
        const anchors = collectMarkdownAnchors(fs.readFileSync(targetPath, 'utf8'));
        if (!anchors.has(anchor)) failures.push(`docs/INDEX.md: missing anchor ${link}`);
      }
    });

    expect(failures).toEqual([]);
  });
});
