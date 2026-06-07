/**
 * Artifact Utilities Module
 *
 * Provides reusable functions for working with artifacts:
 * - Determining artifact type (text vs. binary)
 * - Filtering artifacts by type
 * - Content type classification
 */

/**
 * Determines whether an artifact is text-based or binary based on content type.
 *
 * Text artifacts:
 * - application/json
 * - application/x-jsonl (newline-delimited JSON)
 * - text/* (plain, markdown, etc.)
 * - text/tab-separated-values (TSV)
 *
 * Binary artifacts:
 * - application/zip
 * - application/gzip
 * - application/x-tar
 * - application/vnd.cyclonedx+json (SBOM)
 * - application/octet-stream
 *
 * @param input - Either a content type string or artifact name (used to infer type)
 * @returns true if the artifact is text-based, false if binary
 */
export function isTextArtifact(input: string): boolean {
  // Handle content types directly
  const contentType = input.toLowerCase();

  // Binary content types (explicit exclusion - check first before text types)
  const binaryContentTypes = [
    'application/zip',
    'application/gzip',
    'application/x-gzip',
    'application/x-tar',
    'application/vnd.cyclonedx+json',
    'application/octet-stream',
  ];

  if (binaryContentTypes.includes(contentType)) {
    return false;
  }

  // Text-based content types
  const textContentTypes = [
    'application/json',
    'application/x-jsonl',
    'text/',
  ];

  for (const textType of textContentTypes) {
    if (contentType.startsWith(textType)) {
      return true;
    }
  }

  // Heuristic: check filename extension if input looks like a filename
  if (input.includes('.')) {
    const fileName = input.toLowerCase();
    const extension = fileName.split('.').pop() || '';

    // Check for SBOM files explicitly (even if they end with .json)
    const binaryFilePatterns = ['sbom', 'cyclone'];
    for (const pattern of binaryFilePatterns) {
      if (fileName.includes(pattern)) {
        return false;
      }
    }

    const textExtensions = [
      'json', 'jsonl', 'log', 'txt', 'md', 'markdown',
      'csv', 'tsv', 'htm', 'html', 'xml', 'yaml', 'yml',
      'sh', 'bash', 'py', 'js', 'ts', 'java', 'go', 'rs',
    ];

    const binaryExtensions = [
      'zip', 'gz', 'tar', 'tgz', 'bz2', 'xz',
      'exe', 'bin', 'so', 'dll', 'dylib',
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
      'pdf', 'doc', 'docx', 'xls', 'xlsx',
    ];

    if (textExtensions.includes(extension)) {
      return true;
    }
    if (binaryExtensions.includes(extension)) {
      return false;
    }
  }

  // Default: treat as text if unsure
  // This is safer for display purposes
  return true;
}

/**
 * Filters a list of artifacts to include only text-based artifacts.
 * Removes binary artifacts (zip, gzip, SBOM, etc.).
 *
 * @param artifacts - Array of artifact metadata or objects with contentType
 * @returns Filtered array containing only text artifacts
 */
export function filterTextArtifacts<T extends { contentType: string }>(
  artifacts: T[]
): T[] {
  return artifacts.filter(artifact => isTextArtifact(artifact.contentType));
}

/**
 * Determines the MIME type category of an artifact.
 * Useful for deciding how to display or handle the content.
 *
 * @param contentType - The content type string
 * @returns 'json' | 'jsonl' | 'markdown' | 'text' | 'binary'
 */
export function getArtifactTypeCategory(
  contentType: string
): 'json' | 'jsonl' | 'markdown' | 'text' | 'binary' {
  const type = contentType.toLowerCase();

  if (type === 'application/json') return 'json';
  if (type === 'application/x-jsonl') return 'jsonl';
  if (type === 'text/markdown') return 'markdown';
  if (type.startsWith('text/')) return 'text';

  return 'binary';
}

/**
 * Determines whether an artifact should be displayed inline vs. downloaded.
 *
 * @param contentType - The content type string
 * @returns true if should display inline, false if should download/not show
 */
export function shouldDisplayInline(contentType: string): boolean {
  return isTextArtifact(contentType);
}

export type ArtifactFetchErrorCategory = 'auth' | 'availability' | 'not-found' | 'server' | 'unknown';

export interface ArtifactFetchErrorDetails {
  category: ArtifactFetchErrorCategory;
  message: string;
  retryable: boolean;
}

/**
 * Normalizes failed artifact fetch HTTP responses into user-facing error details.
 *
 * @param status - HTTP status code from the artifact fetch response
 * @returns A stable category, user-facing message, and retry recommendation
 */
export function normalizeArtifactFetchError(status: number): ArtifactFetchErrorDetails {
  if (status === 401) {
    return {
      category: 'auth',
      message: 'Authentication failed: Invalid or expired token. Please re-enter your API key.',
      retryable: false,
    };
  }

  if (status === 400) {
    return {
      category: 'availability',
      message: 'Artifact is not available yet. Please wait for the run to complete.',
      retryable: true,
    };
  }

  if (status === 404) {
    return {
      category: 'not-found',
      message: 'Artifact not found.',
      retryable: false,
    };
  }

  if (status >= 500) {
    return {
      category: 'server',
      message: `Server error: Could not read artifact (${status}).`,
      retryable: true,
    };
  }

  return {
    category: 'unknown',
    message: 'Error loading artifact',
    retryable: false,
  };
}
