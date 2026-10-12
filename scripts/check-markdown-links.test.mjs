import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findBrokenMarkdownLinks } from './check-markdown-links.mjs';

test('finds missing relative Markdown targets and reports their source line', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-links-'));
  try {
    mkdirSync(path.join(repositoryRoot, 'docs'));
    writeFileSync(path.join(repositoryRoot, 'docs', 'present.md'), '# Present\n');
    const markdown = [
      '# Guide',
      '[present](docs/present.md#intro)',
      '[missing](docs/missing.md)',
      '[external](https://example.test/docs.md)',
      '[route](/api/v1/docs)',
      '[section](#guide)',
      '```md',
      '[example](does-not-exist.md)',
      '```',
    ].join('\n');

    assert.deepEqual(
      findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot),
      [{ line: 3, href: 'docs/missing.md', resolvedPath: path.join(repositoryRoot, 'docs', 'missing.md') }],
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('resolves relative links from the Markdown file directory', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-links-'));
  try {
    mkdirSync(path.join(repositoryRoot, 'docs', 'guides'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'docs', 'reference.md'), '# Reference\n');

    assert.deepEqual(
      findBrokenMarkdownLinks('[reference](../reference.md)', 'docs/guides/setup.md', repositoryRoot),
      [],
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
