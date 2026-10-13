import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findBrokenMarkdownLinks, getMarkdownFilesToCheck } from './check-markdown-links.mjs';

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
