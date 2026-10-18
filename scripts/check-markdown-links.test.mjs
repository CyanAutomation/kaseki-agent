import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  findBrokenMarkdownLinks,
  findUnknownNpmScriptReferences,
  getMarkdownFilesToCheck,
} from './check-markdown-links.mjs';

test('checks tracked and untracked Markdown files by default', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-files-'));
  try {
    mkdirSync(path.join(repositoryRoot, 'docs'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, '.agents', 'skills'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'README.md'), '# Readme\n');
    writeFileSync(path.join(repositoryRoot, 'docs', 'guide.MD'), '# Guide\n');
    writeFileSync(path.join(repositoryRoot, 'docs', 'reference.markdown'), '# Reference\n');
    writeFileSync(path.join(repositoryRoot, '.agents', 'skills', 'SKILL.mdx'), '# Skill\n');
    writeFileSync(path.join(repositoryRoot, 'docs', 'draft.md'), '# Draft\n');
    writeFileSync(path.join(repositoryRoot, 'docs', 'ignored.md'), '# Ignored\n');
    writeFileSync(path.join(repositoryRoot, '.gitignore'), 'docs/ignored.md\n');

    execFileSync('git', ['init', '--quiet'], { cwd: repositoryRoot });
    execFileSync('git', ['add', 'README.md', 'docs/guide.MD', 'docs/reference.markdown', '.agents/skills/SKILL.mdx'], {
      cwd: repositoryRoot,
    });

    assert.deepEqual(getMarkdownFilesToCheck([], repositoryRoot), [
      '.agents/skills/SKILL.mdx',
      'README.md',
      'docs/draft.md',
      'docs/guide.MD',
      'docs/reference.markdown',
    ]);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('uses explicitly requested Markdown files when provided', () => {
  assert.deepEqual(getMarkdownFilesToCheck(['README.md', 'docs/changed.md'], '/unused'), [
    'README.md',
    'docs/changed.md',
  ]);
});

test('finds missing relative Markdown targets and reports their source line', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-links-'));
  try {
    mkdirSync(path.join(repositoryRoot, 'docs'));
    writeFileSync(path.join(repositoryRoot, 'docs', 'present.md'), '# Intro\n');
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

test('reports the original line number for links after fenced code blocks', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-links-'));
  try {
    const markdown = [
      '# Guide',
      '```json',
      '{ "sample": "a longer fenced block" }',
      '```',
      '[missing](docs/missing.md)',
    ].join('\n');

    assert.deepEqual(
      findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot),
      [{ line: 5, href: 'docs/missing.md', resolvedPath: path.join(repositoryRoot, 'docs', 'missing.md') }],
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

test('validates fragment-only links against heading slugs and duplicate headings', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-anchors-'));
  try {
    const markdown = [
      '# Guide',
      '## Quick Start',
      '[first](#quick-start)',
      '## Quick Start',
      '[second](#quick-start-1)',
      '[missing](#unknown-section)',
    ].join('\n');

    assert.deepEqual(
      findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot),
      [{
        line: 6,
        href: '#unknown-section',
        resolvedPath: path.join(repositoryRoot, 'README.md'),
        fragment: 'unknown-section',
      }],
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('validates fragments on relative Markdown links', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-anchors-'));
  try {
    mkdirSync(path.join(repositoryRoot, 'docs'));
    writeFileSync(path.join(repositoryRoot, 'docs', 'guide.md'), '# Setup Guide\n');
    const markdown = [
      '[valid](docs/guide.md#setup-guide)',
      '[missing](docs/guide.md#nonexistent)',
    ].join('\n');

    assert.deepEqual(
      findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot),
      [{
        line: 2,
        href: 'docs/guide.md#nonexistent',
        resolvedPath: path.join(repositoryRoot, 'docs', 'guide.md'),
        fragment: 'nonexistent',
      }],
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('matches GitHub heading slugs when punctuation separates words', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-anchors-'));
  try {
    const markdown = [
      '## API Keys & Credentials',
      '[section](#api-keys--credentials)',
    ].join('\n');

    assert.deepEqual(findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot), []);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('recognizes explicitly authored HTML anchors', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-anchors-'));
  try {
    const markdown = [
      '<a id="custom-section"></a>',
      '[section](#custom-section)',
    ].join('\n');

    assert.deepEqual(findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot), []);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('ignores inline HTML tags when matching heading anchors', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'kaseki-markdown-anchors-'));
  try {
    const markdown = [
      '## <span>Safe heading</span>',
      '[section](#safe-heading)',
    ].join('\n');

    assert.deepEqual(findBrokenMarkdownLinks(markdown, 'README.md', repositoryRoot), []);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('finds npm run commands that are not package scripts and reports their source line', () => {
  const markdown = [
    'Run `npm run check` before submitting.',
    '```bash',
    'npm run test:unit -- path/to/test',
    'npm run test:smoke',
    'npm test',
    '```',
    'Run `npm run missing:script` after the example.',
  ].join('\n');

  assert.deepEqual(
    findUnknownNpmScriptReferences(markdown, { check: 'node check.js', 'test:unit': 'jest' }),
    [{ line: 7, script: 'missing:script' }],
  );
});

test('checks the npm test alias against package scripts', () => {
  assert.deepEqual(
    findUnknownNpmScriptReferences('Run `npm test` before submitting.', {}),
    [{ line: 1, script: 'test' }],
  );
});
