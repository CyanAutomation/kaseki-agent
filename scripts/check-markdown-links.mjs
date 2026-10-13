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
 * Find missing relative file targets in inline Markdown links.
 * External URLs, site-root paths, and fragment-only links are intentionally skipped.
 */
export function findBrokenMarkdownLinks(markdown, sourceFile, repositoryRoot = process.cwd()) {
  const sourcePath = path.resolve(repositoryRoot, sourceFile);
  const scannedMarkdown = stripFencedCodeBlocks(markdown);
  const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  const brokenLinks = [];
  let match;

  while ((match = linkPattern.exec(scannedMarkdown)) !== null) {
    const href = match[1] ?? match[2];
    if (!href || href.startsWith('#') || href.startsWith('/') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) {
      continue;
    }

    const relativeTarget = href.split(/[?#]/, 1)[0];
    if (!relativeTarget) continue;

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(relativeTarget);
    } catch {
      decodedTarget = relativeTarget;
    }

    const resolvedPath = path.resolve(path.dirname(sourcePath), decodedTarget);
    if (!existsSync(resolvedPath)) {
      brokenLinks.push({
        line: scannedMarkdown.slice(0, match.index).split('\n').length,
        href,
        resolvedPath,
      });
    }
  }

  return brokenLinks;
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
      console.error(`${sourceFile}:${link.line}: missing local target "${link.href}"`);
      hasErrors = true;
    }
  }

  if (hasErrors) process.exitCode = 1;
  else console.log(`Checked local Markdown links in ${files.length} file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
