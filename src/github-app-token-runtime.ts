export function resolveGitHubAppTokenRuntimeImport(
  moduleSpecifier: string,
  moduleUrl: string
): string {
  let decodedModuleSpecifier = moduleSpecifier;
  let previousDecoded = '';
  
  // Decode recursively until stable to prevent double-encoding bypass
  while (decodedModuleSpecifier !== previousDecoded) {
    previousDecoded = decodedModuleSpecifier;
    decodedModuleSpecifier = decodeURIComponent(decodedModuleSpecifier);
  }

  if (
    !decodedModuleSpecifier.startsWith('./') ||
    decodedModuleSpecifier.split('/').includes('..')
  ) {
    throw new Error(
      'GitHub App token runtime imports must be explicit nested relative paths from the installed helper'
    );
  }

  return new URL(moduleSpecifier, moduleUrl).href;
}
