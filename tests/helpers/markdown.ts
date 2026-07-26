export type MarkdownLink = {
  text: string;
  link: string;
  sourceFile: string;
};

const decodeLinkComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const stripFencedCodeBlocks = (content: string): string => {
  const lines = content.split(/\r?\n/);
  let fence: { marker: string; length: number } | undefined;

  return lines.map((line) => {
    const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!fence && opening) {
      fence = { marker: opening[1][0], length: opening[1].length };
      return '';
    }

    if (fence) {
      const closing = line.match(/^\s{0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        fence = undefined;
      }
      return '';
    }

    return line;
  }).join('\n');
};

export const slugifyHeading = (heading: string): string => heading
  .trim()
  .toLowerCase()
  .replace(/<[^>]+>/g, '')
  .replace(/[`*_~[\]()]/g, '')
  .replace(/&/g, '')
  .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
  .trim()
  .replace(/\s/g, '-');

export const collectMarkdownAnchors = (content: string): Set<string> => {
  const anchors = new Set<string>();
  const slugCounts = new Map<string, number>();
  const headingRegex = /^#{1,6}[\t ]+(.+?)[\t ]*#*[\t ]*$/gm;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(stripFencedCodeBlocks(content))) !== null) {
    const baseSlug = slugifyHeading(match[1]);
    const occurrence = slugCounts.get(baseSlug) ?? 0;
    anchors.add(occurrence === 0 ? baseSlug : `${baseSlug}-${occurrence}`);
    slugCounts.set(baseSlug, occurrence + 1);
  }

  return anchors;
};

export const extractMarkdownLinks = (content: string, sourceFile: string): MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(stripFencedCodeBlocks(content))) !== null) {
    const destination = match[2].trim().match(/^(?:<([^>]+)>|([^\s]+))(?:\s+["'].*["'])?$/);
    if (destination) {
      links.push({ text: match[1], link: destination[1] ?? destination[2], sourceFile });
    }
  }

  return links;
};

export const isExternalMarkdownLink = (link: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//');

export const splitMarkdownLink = (link: string): { filePart: string; anchor?: string } => {
  const hashIndex = link.indexOf('#');
  const beforeFragment = hashIndex === -1 ? link : link.slice(0, hashIndex);
  const rawAnchor = hashIndex === -1 ? undefined : link.slice(hashIndex + 1);
  const queryIndex = beforeFragment.indexOf('?');
  const rawFilePart = queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex);

  return {
    filePart: decodeLinkComponent(rawFilePart.trim()),
    anchor: rawAnchor ? decodeLinkComponent(rawAnchor) : undefined,
  };
};
