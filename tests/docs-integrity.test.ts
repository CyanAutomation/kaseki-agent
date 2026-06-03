import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for documentation link integrity and explicit cross-reference checklists.
 *
 * These tests avoid broad keyword-presence assertions. They validate the
 * documentation graph instead: required docs are present, required cross-reference
 * links exist, and internal markdown links resolve to real files and anchors.
 */
describe('Documentation link integrity', () => {
  const projectRoot = process.cwd();
  const docsDir = path.join(projectRoot, 'docs');
  const requiredEvaluationDocs = [
    'GOAL_SETTING_GUIDE.md',
    'EVALUATION_BEST_PRACTICES.md',
    'FEEDBACK_LOOP_INTEGRATION.md',
  ];

  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  const readDoc = (fileName: string): string => fs.readFileSync(path.join(docsDir, fileName), 'utf8');

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

    headingRegex.lastIndex = 0;
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
    return filePart.startsWith('./') ? filePart.substring(2) : filePart;
  };

  describe('required evaluation docs checklist', () => {
    it('required evaluation docs should exist and be linked from GOAL_SETTING_GUIDE.md', () => {
      requiredEvaluationDocs.forEach((fileName) => {
        expect(fs.existsSync(path.join(docsDir, fileName))).toBe(true);
      });

      const goalSettingLinks = extractMarkdownLinks(readDoc('GOAL_SETTING_GUIDE.md'))
        .map(({ link }) => normalizeDocLink(link));

      expect(goalSettingLinks).toContain('EVALUATION_BEST_PRACTICES.md');
      expect(goalSettingLinks).toContain('FEEDBACK_LOOP_INTEGRATION.md');
    });

    it('evaluation best-practices should link back to related evaluation docs', () => {
      const bestPracticesLinks = extractMarkdownLinks(readDoc('EVALUATION_BEST_PRACTICES.md'))
        .map(({ link }) => normalizeDocLink(link));

      expect(bestPracticesLinks).toContain('GOAL_SETTING_GUIDE.md');
      expect(bestPracticesLinks).toContain('FEEDBACK_LOOP_INTEGRATION.md');
    });
  });

  describe('internal markdown links', () => {
    it('evaluation docs should not contain broken file links or anchor links', () => {
      requiredEvaluationDocs.forEach((sourceFileName) => {
        const sourcePath = path.join(docsDir, sourceFileName);
        const content = fs.readFileSync(sourcePath, 'utf8');
        const links = extractMarkdownLinks(content);

        links.forEach(({ link }) => {
          if (link.startsWith('http') || link.startsWith('mailto:')) {
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
});
