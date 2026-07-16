import { describe, expect, it } from '@jest/globals';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveGitHubAppTokenRuntimeImport } from '../src/github-app-token-runtime';

describe('github-app-token runtime import resolution', () => {
  const installedHelperUrl = pathToFileURL(
    path.join('/opt/kaseki-package/usr/local/bin', 'github-app-token.js')
  ).href;

  it('resolves runtime helpers relative to the installed helper file', () => {
    // Packaged GitHub App token helper execution installs the helper and its
    // runtime modules together; dynamic imports must follow that installed
    // helper layout instead of the source tree layout.
    expect(resolveGitHubAppTokenRuntimeImport('./github-utils.js', installedHelperUrl)).toBe(
      'file:///opt/kaseki-package/usr/local/bin/github-utils.js'
    );
    expect(
      resolveGitHubAppTokenRuntimeImport('./secrets/host-secrets-reader.js', installedHelperUrl)
    ).toBe('file:///opt/kaseki-package/usr/local/bin/secrets/host-secrets-reader.js');
  });

  it('resolves nested runtime helper paths under the installed helper directory', () => {
    expect(
      resolveGitHubAppTokenRuntimeImport(
        './github-app-token-runtime/nested/token-helper.js',
        installedHelperUrl
      )
    ).toBe(
      'file:///opt/kaseki-package/usr/local/bin/github-app-token-runtime/nested/token-helper.js'
    );
  });

  it.each([
    ['bare specifier', 'github-utils.js'],
    ['absolute filesystem path', '/opt/kaseki-package/usr/local/bin/github-utils.js'],
    ['file URL', 'file:///opt/kaseki-package/usr/local/bin/github-utils.js'],
    ['parent traversal', './../github-utils.js'],
    ['nested parent traversal', './secrets/../github-utils.js'],
    ['URL-encoded parent traversal', './%2e%2e/github-utils.js'],
    ['uppercase URL-encoded parent traversal', './%2E%2E/github-utils.js'],
    ['empty specifier', ''],
  ])('rejects unsupported %s imports', (_name, moduleSpecifier) => {
    expect(() =>
      resolveGitHubAppTokenRuntimeImport(moduleSpecifier, installedHelperUrl)
    ).toThrow('GitHub App token runtime imports must be explicit nested relative paths');
  });
});
