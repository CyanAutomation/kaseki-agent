export function resolveGitHubAppTokenRuntimeImport(
  moduleSpecifier: string,
  moduleUrl: string
): string {
  if (!moduleSpecifier.startsWith('./') || moduleSpecifier.split('/').includes('..')) {
    throw new Error(
      'GitHub App token runtime imports must be explicit nested relative paths from the installed helper'
    );
  }

  return new URL(moduleSpecifier, moduleUrl).href;
}
