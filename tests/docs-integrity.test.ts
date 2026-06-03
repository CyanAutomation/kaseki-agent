import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for documentation link integrity and explicit cross-reference checklists.
 *
 * This avoids broad keyword-presence assertions. It validates the documentation
 * graph instead: required docs are present, required cross-reference links and
 * headings exist, and internal markdown links resolve to real files and anchors.
 */
describe('Documentation link integrity', () => {
  const projectRoot = process.cwd();
  const docsDir = path.join(projectRoot, 'docs');
  const evaluationDocs = [
    'GOAL_SETTING_GUIDE.md',
    'EVALUATION_BEST_PRACTICES.md',
    'FEEDBACK_LOOP_INTEGRATION.md',
  ];

  const requiredDocLinks = new Map<string, string[]>([
    ['GOAL_SETTING_GUIDE.md', ['./EVALUATION_BEST_PRACTICES.md', './FEEDBACK_LOOP_INTEGRATION.md']],
    ['EVALUATION_BEST_PRACTICES.md', ['GOAL_SETTING_GUIDE.md', 'FEEDBACK_LOOP_INTEGRATION.md']],
  ]);

  const requiredDocHeadings = new Map<string, string[]>([
    ['GOAL_SETTING_GUIDE.md', ['## See Also']],
    ['EVALUATION_BEST_PRACTICES.md', ['## Part 4: Feedback Loop Integration', '## References']],
    [
      'FEEDBACK_LOOP_INTEGRATION.md',
      ['## Feedback Path 1: Goal Quality Scoring', '## Feedback Path 2: Kaseki Improvement Opportunities'],
    ],
  ]);

  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  const slugifyHeading = (heading: string): string => heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/&/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

  const collectAnchors = (content: string): Set<string> => {
    const anchors = new Set<string>();
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    let headingMatch: RegExpExecArray | null;

    while ((headingMatch = headingRegex.exec(content)) !== null) {
      anchors.add(slugifyHeading(headingMatch[1]));
    }

    return anchors;
  };

  const extractMarkdownLinks = (content: string): Array<{ text: string; link: string }> => {
    const links: Array<{ text: string; link: string }> = [];
    let match: RegExpExecArray | null;

    markdownLinkRegex.lastIndex = 0;
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      links.push({ text: match[1], link: match[2] });
    }

    return links;
  };

  const normalizeDocLink = (link: string): string => {
    const [filePart] = link.split('#');
    if (!filePart) {
      return '';
    }
    return filePart.startsWith('./') ? filePart.substring(2) : filePart;
  };

  it('checks exact cross-document links, expected headings, and markdown link targets for evaluation docs', () => {
    evaluationDocs.forEach((fileName) => {
      const sourcePath = path.join(docsDir, fileName);
      expect(fs.existsSync(sourcePath)).toBe(true);

      const content = fs.readFileSync(sourcePath, 'utf8');
      const links = extractMarkdownLinks(content);
      const linkTargets = links.map(({ link }) => link);

      requiredDocLinks.get(fileName)?.forEach((requiredLink) => {
        expect(linkTargets).toContain(requiredLink);
      });

      requiredDocHeadings.get(fileName)?.forEach((requiredHeading) => {
        expect(content).toContain(requiredHeading);
      });

      links.forEach(({ link }) => {
        if (link.startsWith('http') || link.startsWith('mailto:')) {
          return;
        }

        if (link.startsWith('#')) {
          const anchor = link.substring(1);
          const anchors = collectAnchors(content);
          expect(anchors).toContain(anchor);
          return;
        }

        const [rawFilePart, anchor] = link.split('#');
        const filePart = normalizeDocLink(rawFilePart);
        const targetPath = filePart ? path.join(docsDir, filePart) : sourcePath;

        expect(fs.existsSync(targetPath)).toBe(true);

        if (anchor) {
          const targetContent = fs.readFileSync(targetPath, 'utf8');
          const anchors = collectAnchors(targetContent);
          expect(anchors).toContain(anchor);
        }
      });
    });
  });
});
