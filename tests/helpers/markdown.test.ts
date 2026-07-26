import {
  collectMarkdownAnchors,
  extractMarkdownLinks,
  splitMarkdownLink,
} from './markdown';

describe('Markdown parsing helpers', () => {
  it('ignores headings and links inside backtick and tilde fenced code', () => {
    const markdown = [
      '# Visible',
      '```markdown',
      '# Hidden',
      '[hidden](missing.md)',
      '```',
      '~~~',
      '[also hidden](missing-too.md)',
      '~~~',
      '[visible](present.md)',
    ].join('\n');

    expect([...collectMarkdownAnchors(markdown)]).toEqual(['visible']);
    expect(extractMarkdownLinks(markdown, 'fixture.md').map(({ link }) => link)).toEqual(['present.md']);
  });

  it('matches GitHub-style suffixes for duplicate headings', () => {
    expect([...collectMarkdownAnchors('# Result\n## Result\n## Result')]).toEqual([
      'result',
      'result-1',
      'result-2',
    ]);
  });

  it.each([
    ['folder/My%20Guide.md#encoded%20anchor', { filePart: 'folder/My Guide.md', anchor: 'encoded anchor' }],
    ['guide.md?view=compact#details', { filePart: 'guide.md', anchor: 'details' }],
    ['#relative-anchor', { filePart: '', anchor: 'relative-anchor' }],
  ])('splits URL-encoded, queried, and relative destinations: %s', (link, expected) => {
    expect(splitMarkdownLink(link)).toEqual(expected);
  });
});
