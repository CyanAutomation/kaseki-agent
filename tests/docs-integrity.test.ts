import * as fs from 'fs';
import * as path from 'path';

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

  type MarkdownLink = {
    text: string;
    link: string;
    sourceFile: string;
  };

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
      requiredLinks: ['../src/lib/goal-setting-feedback.ts', '../scripts/analyze-goal-feedback.js'],
      stableAnchors: [
        'feedback-loop-integration-for-kaseki-agent-evaluations',
        'feedback-path-1-goal-quality-scoring',
        'feedback-path-2-kaseki-improvement-opportunities',
        'integration-points',
        'data-schema',
      ],
    },
  ];

  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const fencedCodeBlockRegex = /^```[\s\S]*?^```$/gm;

  const stripFencedCodeBlocks = (content: string): string => content.replace(fencedCodeBlockRegex, '');

  const slugifyHeading = (heading: string): string => heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/&/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

  const collectAnchors = (content: string): Set<string> => {
    const anchors = new Set<string>();
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    let headingMatch: RegExpExecArray | null;
    const markdownWithoutCode = stripFencedCodeBlocks(content);

    while ((headingMatch = headingRegex.exec(markdownWithoutCode)) !== null) {
      anchors.add(slugifyHeading(headingMatch[1]));
    }

    return anchors;
  };

  const extractMarkdownLinks = (content: string, sourceFile: string): MarkdownLink[] => {
    const links: MarkdownLink[] = [];
    let match: RegExpExecArray | null;
    const markdownWithoutCode = stripFencedCodeBlocks(content);

    markdownLinkRegex.lastIndex = 0;
    while ((match = markdownLinkRegex.exec(markdownWithoutCode)) !== null) {
      links.push({ text: match[1], link: match[2], sourceFile });
    }

    return links;
  };

  const isExternalLink = (link: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(link);

  const splitLink = (link: string): { filePart: string; anchor?: string } => {
    const [rawFilePart, rawAnchor] = link.split('#');
    const [filePart] = rawFilePart.split(/[?;]/).map(s => s.trim());

    return {
      filePart: filePart ? decodeURIComponent(filePart) : '',
      anchor: rawAnchor ? decodeURIComponent(rawAnchor) : undefined,
    };
  };

  it('resolves internal markdown links and anchors in evaluation docs', () => {
    evaluationDocContracts.forEach(({ fileName }) => {
      const sourcePath = path.join(docsDir, fileName);
      const sourceContent = fs.readFileSync(sourcePath, 'utf8');
      const sourceDir = path.dirname(sourcePath);
      const sourceFile = path.relative(projectRoot, sourcePath);
      const sourceAnchors = collectAnchors(sourceContent);

      extractMarkdownLinks(sourceContent, sourceFile).forEach(({ link }) => {
        if (isExternalLink(link)) {
          return;
        }

        const { filePart, anchor } = splitLink(link);
        const targetPath = filePart ? path.resolve(sourceDir, filePart) : sourcePath;

        expect(fs.existsSync(targetPath)).toBe(true);

        if (anchor) {
          const targetContent = targetPath === sourcePath
            ? sourceContent
            : fs.readFileSync(targetPath, 'utf8');
          const targetAnchors = targetPath === sourcePath ? sourceAnchors : collectAnchors(targetContent);

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
      const anchors = collectAnchors(sourceContent);

      requiredLinks?.forEach((requiredLink) => {
        expect(linkTargets).toContain(requiredLink);
      });

      stableAnchors?.forEach((stableAnchor) => {
        expect(anchors).toContain(stableAnchor);
      });
    });
  });
});
