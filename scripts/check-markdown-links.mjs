import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function stripFencedCodeBlocks(markdown) {
  let fenceCharacter = null;
  let fenceLength = 0;

  return markdown.split('\n').map((line) => {
    if (fenceCharacter) {
      const closingFence = new RegExp(`^ {0,3}${fenceCharacter}{${fenceLength},}\\s*$`);
      if (closingFence.test(line)) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      return '';
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      fenceCharacter = openingFence[1][0];
      fenceLength = openingFence[1].length;
      return '';
    }

    return line;
  }).join('\n');
}

/**
 * Find missing relative file targets and heading anchors in inline Markdown links.
 * External URLs and site-root paths are intentionally skipped.
 */
export function findBrokenMarkdownLinks(markdown, sourceFile, repositoryRoot = process.cwd()) {
  const sourcePath = path.resolve(repositoryRoot, sourceFile);
  const scannedMarkdown = stripFencedCodeBlocks(markdown);
  const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  const brokenLinks = [];
  let match;

  while ((match = linkPattern.exec(scannedMarkdown)) !== null) {
    const href = match[1] ?? match[2];
    if (!href || href.startsWith('/') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) {
      continue;
    }

    const fragmentStart = href.indexOf('#');
    const linkPath = fragmentStart === -1 ? href : href.slice(0, fragmentStart);
    const fragment = fragmentStart === -1 ? '' : href.slice(fragmentStart + 1);
    const relativeTarget = linkPath.split('?', 1)[0];

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(relativeTarget);
    } catch {
      decodedTarget = relativeTarget;
    }

    const resolvedPath = relativeTarget
      ? path.resolve(path.dirname(sourcePath), decodedTarget)
      : sourcePath;
    const isSameDocument = relativeTarget.length === 0;
    const line = scannedMarkdown.slice(0, match.index).split('\n').length;

    if (!isSameDocument && !existsSync(resolvedPath)) {
      brokenLinks.push({
        line,
        href,
        resolvedPath,
      });
      continue;
    }

    if (fragment && /\.(?:md|markdown|mdx)$/i.test(resolvedPath)) {
      let decodedFragment;
      try {
        decodedFragment = decodeURIComponent(fragment);
      } catch {
        decodedFragment = fragment;
      }

      const targetMarkdown = isSameDocument ? markdown : readFileSync(resolvedPath, 'utf8');
      if (!collectMarkdownAnchors(targetMarkdown).has(decodedFragment)) {
        brokenLinks.push({ line, href, resolvedPath, fragment: decodedFragment });
      }
    }
  }

  return brokenLinks;
}

function slugHeading(heading) {
  const plainHeading = stripInlineHtmlTags(heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));

  return plainHeading
    .replace(/`([^`]*)`/g, '$1')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function stripInlineHtmlTags(heading) {
  let textStart = 0;
  let index = 0;
  const text = [];

  while (index < heading.length) {
    if (heading[index] !== '<') {
      index += 1;
      continue;
    }

    let tagStart = index + 1;
    if (heading[tagStart] === '/') tagStart += 1;
    if (!/[A-Za-z]/.test(heading[tagStart] ?? '')) {
      index += 1;
      continue;
    }

    let tagEnd = tagStart + 1;
    while (tagEnd < heading.length && heading[tagEnd] !== '>' && heading[tagEnd] !== '<' && heading[tagEnd] !== '\n') {
      tagEnd += 1;
    }

    if (heading[tagEnd] === '>') {
      text.push(heading.slice(textStart, index));
      textStart = tagEnd + 1;
      index = textStart;
    } else {
      index += 1;
    }
  }

  text.push(heading.slice(textStart));
  return text.join('');
}

function collectMarkdownAnchors(markdown) {
  const scannedMarkdown = stripFencedCodeBlocks(markdown);
  const lines = scannedMarkdown.split('\n');
  const anchors = new Set();
  const headingSlugs = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const atxHeading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const setextHeading = !atxHeading && line.trim() && lines[index + 1]?.match(/^ {0,3}(?:=+|-+)\s*$/)
      ? line.trim()
      : undefined;
    const heading = atxHeading?.[1] ?? setextHeading;

    if (heading) {
      const baseSlug = slugHeading(heading);
      let slug = baseSlug;
      let suffix = 0;
      while (headingSlugs.has(slug)) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
      }
      headingSlugs.add(slug);
      anchors.add(slug);
    }
  }

  for (const match of scannedMarkdown.matchAll(/<[A-Za-z][^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
    anchors.add(match[1]);
  }

  return anchors;
}

/**
 * Find npm scripts referenced by the root README and developer guides that are
 * not defined by this repository's package.json.
 */
export function findUnknownNpmScriptReferences(markdown, packageScripts = {}) {
  const scannedMarkdown = stripFencedCodeBlocks(markdown);
  const unknownScripts = [];
  const scriptPattern = /\bnpm\s+(?:run\s+([A-Za-z0-9][A-Za-z0-9:_-]*)|(test)\b)/g;
  let match;

  while ((match = scriptPattern.exec(scannedMarkdown)) !== null) {
    const script = match[1] ?? match[2];
    if (!Object.hasOwn(packageScripts, script)) {
      unknownScripts.push({
        line: scannedMarkdown.slice(0, match.index).split('\n').length,
        script,
      });
    }
  }

  return unknownScripts;
}

/**
 * Select explicit files or discover repository Markdown files, including new files.
 */
export function getMarkdownFilesToCheck(sourceFiles = [], repositoryRoot = process.cwd()) {
  if (sourceFiles.length > 0) return sourceFiles;

  const repositoryFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return repositoryFiles
    .split('\0')
    .filter((file) => /\.(?:md|markdown|mdx)$/i.test(file))
    .sort();
}

function main() {
  const repositoryRoot = process.cwd();
  const files = getMarkdownFilesToCheck(process.argv.slice(2), repositoryRoot);
  const checkedCommandDocs = new Set(['README.md', 'CONTRIBUTING.md', 'docs/DEVELOPMENT.md']);
  const commandDocFiles = files.filter((sourceFile) => checkedCommandDocs.has(path.normalize(sourceFile)));
  const packageJsonPath = path.join(repositoryRoot, 'package.json');
  const packageScripts = existsSync(packageJsonPath)
    ? JSON.parse(readFileSync(packageJsonPath, 'utf8')).scripts ?? {}
    : {};
  let hasErrors = false;

  for (const sourceFile of files) {
    const sourcePath = path.resolve(repositoryRoot, sourceFile);
    if (!existsSync(sourcePath)) {
      console.error(`${sourceFile}: Markdown source file does not exist`);
      hasErrors = true;
      continue;
    }

    const markdown = readFileSync(sourcePath, 'utf8');
    const brokenLinks = findBrokenMarkdownLinks(markdown, sourceFile, repositoryRoot);
    for (const link of brokenLinks) {
      const message = link.fragment
        ? `missing heading anchor "${link.fragment}" in "${link.resolvedPath}"`
        : `missing local target "${link.href}"`;
      console.error(`${sourceFile}:${link.line}: ${message}`);
      hasErrors = true;
    }

    if (checkedCommandDocs.has(path.normalize(sourceFile))) {
      const unknownScripts = findUnknownNpmScriptReferences(markdown, packageScripts);
      for (const unknownScript of unknownScripts) {
        console.error(`${sourceFile}:${unknownScript.line}: npm script "${unknownScript.script}" is not defined in package.json`);
        hasErrors = true;
      }
    }
  }

  if (hasErrors) process.exitCode = 1;
  else console.log(
    `Checked local Markdown links in ${files.length} file(s) and npm scripts in ${commandDocFiles.length} developer guide(s).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
