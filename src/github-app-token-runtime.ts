export function resolveGitHubAppTokenRuntimeImport(
  moduleSpecifier: string,
  moduleUrl: string
): string {
  return new URL(moduleSpecifier, moduleUrl).href;
}
