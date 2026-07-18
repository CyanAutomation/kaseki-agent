export function resolveGitHubAppTokenRuntimeImport(
  moduleSpecifier: string,
  moduleUrl: string
): string {
  let decodedModuleSpecifier = moduleSpecifier;
  let previousDecoded = '';

  // Decode recursively until stable to prevent double-encoding bypass
  while (decodedModuleSpecifier !== previousDecoded) {
    previousDecoded = decodedModuleSpecifier;
    try {
      decodedModuleSpecifier = decodeURIComponent(decodedModuleSpecifier);
    } catch {
      throw new Error(
        'GitHub App token runtime imports must be explicit nested relative paths from the installed helper'
      );
    }
  }

  const decodedSegments = decodedModuleSpecifier.split('/');

  if (
    !decodedModuleSpecifier.startsWith('./') ||
    decodedSegments.some((segment) => segment.includes('..') || segment.includes('\0'))
  ) {
    throw new Error(
      'GitHub App token runtime imports must be explicit nested relative paths from the installed helper'
    );
  }

  return new URL(decodedModuleSpecifier, moduleUrl).href;
}
