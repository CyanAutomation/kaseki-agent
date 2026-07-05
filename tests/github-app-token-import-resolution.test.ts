import { describe, expect, it } from '@jest/globals';
import { pathToFileURL } from 'url';
import path from 'path';
import { resolveGitHubAppTokenRuntimeImport } from '../src/github-app-token-runtime';

describe('github-app-token runtime import resolution', () => {
  it('resolves runtime helpers relative to the installed helper file', () => {
    const installedHelperUrl = pathToFileURL(
      path.join('/opt/kaseki-package/usr/local/bin', 'github-app-token.js')
    ).href;

    expect(resolveGitHubAppTokenRuntimeImport('./github-utils.js', installedHelperUrl)).toBe(
      'file:///opt/kaseki-package/usr/local/bin/github-utils.js'
    );
    expect(
      resolveGitHubAppTokenRuntimeImport('./secrets/host-secrets-reader.js', installedHelperUrl)
    ).toBe('file:///opt/kaseki-package/usr/local/bin/secrets/host-secrets-reader.js');
  });
});
