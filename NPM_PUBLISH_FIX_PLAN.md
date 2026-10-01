# NPM Publishing Fix Plan

**Issue Date**: 2026-09-18  
**Issue Type**: OIDC Trusted Publishing Configuration
**Exit Code**: 404 Not Found on npm publish

## Current GitHub Actions Wiring

The release workflow now calls the reusable `publish-npm.yml` workflow only
after semantic-release creates a new release. Because npm validates the caller
when a reusable workflow runs `npm publish`, configure the trusted publisher
for organization `CyanAutomation`, repository `kaseki-agent`, workflow filename
`release.yml`, and environment `release`. Allow direct `npm publish` for this
publisher. Both the caller job and the reusable workflow need `id-token: write`.

The npm trusted-publisher settings are external to this repository and must be
configured before the next GitHub release can publish successfully. See the
[npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
for the current setup fields and reusable-workflow behavior.

## Problem Analysis

### Root-Cause Test

Do not infer the root cause from the verifier's later `E404`. That response only
shows that the requested version was not readable when the verifier polled. The
complete `Publish exact verified package` log determines whether publication
was accepted:

1. Record the npm CLI version used by the runner.
2. Determine whether npm attempted and completed an OIDC token exchange.
3. Record the HTTP status of the package registry `PUT`.
4. Record npm's final success or warning line.

If token exchange fails or the registry does not accept the `PUT`, correct the
trusted-publisher configuration described below. Only a successful registry
write followed by a temporary read failure supports an indexing-delay diagnosis.

### Evidence from Logs

```
npm notice npm tokens that bypass 2FA are being restricted...
npm http fetch POST 404 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@cyanautomation%2fkaseki-agent
npm verbose oidc Failed token exchange request with body message: OIDC token exchange error - package not found
```

The "package not found" error in the OIDC exchange is the actual blocker, not a registry indexing issue.

---

## Solution Overview

Configure OIDC trusted publishing on the npm account to allow GitHub Actions to publish without hardcoded tokens. This is a **one-time setup** on the npm side.

### High-Level Steps

1. **Configure OIDC on npm account** (manual, one-time)
2. **Verify workflow configuration** (already correct)
3. **Retry the publish** via GitHub Actions
4. **Document the process**

---

## Detailed Implementation Plan

### Phase 1: OIDC Configuration on npm (Manual Step)

**Owner**: Account administrator with access to `@cyanautomation` npm organization  
**Time**: ~5 minutes  
**Prerequisites**: npm account login, GitHub account linked to repository

#### Steps

1. **Log in to npm**:
   - Go to [npmjs.com](https://npmjs.com)
   - Sign in as owner of `@cyanautomation` organization

2. **Open the package's trusted-publisher settings**:
   - Open `@cyanautomation/kaseki-agent` on npm and select **Settings**.
   - In **Trusted Publisher**, select GitHub Actions.

3. **Configure the exact caller identity**:
   - Organization or user: `CyanAutomation`
   - Repository: `kaseki-agent`
   - Workflow filename: `release.yml`
   - Environment: `release`
   - Enable direct publication for this trusted publisher.

   npm validates the caller workflow, not the reusable workflow that contains
   the `npm publish` command. Therefore the workflow filename must be
   `release.yml`, not `publish-npm.yml`.

4. **Verify Configuration**:
   - npm settings should now show GitHub Actions as a trusted publisher
   - The OIDC trust relationship is established between npm and GitHub

### Phase 2: Verify Workflow Configuration

**Status**: ✅ Already Correct

The workflow file `.github/workflows/publish-npm.yml` has all necessary OIDC configuration:

```yaml
permissions:
  contents: read
  id-token: write  # ← Required for OIDC token generation

steps:
  - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
    with:
      node-version: "24"
      registry-url: https://registry.npmjs.org  # ← Enables OIDC in npm CLI
      cache: npm
  
  - run: npm publish --access public --provenance --loglevel verbose
```

**No changes needed to workflow** — it's already OIDC-ready.

### Phase 3: Retry Publishing

**Owner**: Anyone with GitHub Actions re-run permissions  
**Time**: ~10 minutes (including indexing delay)

#### Steps

1. **Find the failed workflow run**:
   - GitHub repository → Actions → "Release" workflow
   - Find the run dated 2026-09-18
   - Note the run number

2. **Record the failed publish evidence before retrying**:
   - Expand the complete `Publish exact verified package` log, including the
     lines immediately before `Verify published package` fails.
   - Record the npm CLI version, whether the OIDC token exchange occurred, the
     HTTP status of the registry `PUT`, and npm's final success or warning line.
   - Do not treat a later verifier `E404` as proof of an indexing-only failure;
     first establish whether the registry accepted the package write.

3. **Re-run the publish job**:
   - Open the failed "publish_npm" job
   - Click "Re-run failed jobs" (or "Re-run all jobs" to be thorough)
   - Preserve the original immutable `ref` and `version` inputs. Do not dispatch
     a new release or substitute a branch ref.
   - Wait for the workflow to complete

4. **Monitor the new attempt**:
   - OIDC token exchange should now succeed
   - The registry `PUT` must complete successfully (normally HTTP 200 or 201)
     and npm must print its final success line before verifier polling is used
     as evidence of publication
   - Provenance statement should be generated and published to sigstore

5. **Verify publication**:
   - Once workflow succeeds, check npm registry:

     ```bash
     npm view @cyanautomation/kaseki-agent@<version>
     ```

   - Should return package information (not 404)
   - Registry indexing may take 30-60 seconds; script will retry automatically

### Phase 4: Documentation & Prevention

**Owner**: Release/docs maintainer  
**Time**: ~15 minutes

#### Updates Needed

1. **Update DEPLOYMENT.md**:
   - ✅ Already has OIDC troubleshooting section
   - Consider adding a "First-time Release Setup Checklist" section

2. **Add GitHub Organization Secrets** (optional):
   - Document that no npm tokens are needed in GitHub Secrets
   - OIDC handles authentication automatically
   - Verify "release" environment has correct permissions:

     ```yaml
     permissions:
       contents: write
       id-token: write  # Required for OIDC
     ```

3. **Create Release Checklist**:
   - Add to CONTRIBUTING.md or docs/RELEASE.md:

     ```
     - [ ] OIDC trusted publishing configured on npm
     - [ ] GitHub Actions repo secret not needed (use OIDC instead)
     - [ ] Verify npm account has GitHub Actions authorized
     - [ ] Test publish with dry-run first: `npm run release:dry`
     ```

---

## Success Criteria

- [ ] OIDC configured on npm account for CyanAutomation/kaseki-agent repository
- [ ] Publish workflow completes with:
  - npm publish successful (HTTP 201 or 200)
  - OIDC token exchange successful
  - Provenance statement published to sigstore transparency log
- [ ] The exact released `@cyanautomation/kaseki-agent@<version>` is available on npm
- [ ] `npm view @cyanautomation/kaseki-agent@<version>` returns package metadata
- [ ] No hardcoded npm tokens in GitHub Secrets
- [ ] Documentation updated with OIDC troubleshooting guide

---

## Risk Assessment

### Low Risk Areas

- OIDC configuration on npm (standard npm feature, no breaking changes)
- Workflow retry (idempotent, version already prepared)
- No code changes needed

### Mitigation

- OIDC is one-time setup; once enabled, all future publishes work automatically
- Workflow has safety checks to prevent double-publishing same version
- Provenance verification ensures artifact integrity

---

## Timeline

| Phase | Task | Duration | Owner |
| ------- | ------ | ---------- | ------- |
| 1 | Configure OIDC on npm | 5 min | Account admin |
| 2 | Verify workflow config | 2 min | DevOps |
| 3 | Retry publish job | 10 min | Release manager |
| 4 | Update docs | 15 min | Docs maintainer |
| **Total** | | **~30 min** | |

---

## Recovery Plan (If Needed)

If the retry still fails after OIDC setup:

1. **Check npm OIDC logs**:
   - npm settings → GitHub Actions → view logs
   - Verify repository name matches exactly: `CyanAutomation/kaseki-agent`

2. **Verify package.json**:
   - Confirm `"name": "@cyanautomation/kaseki-agent"`
   - Check `"publishConfig": { "access": "public", "provenance": true }`

3. **Check for typos**:
   - Organization name: `cyanautomation` (lowercase)
   - Package name: `kaseki-agent` (with hyphen)
   - Repository: `CyanAutomation/kaseki-agent` (case-sensitive on GitHub)

4. **Contact npm support**:
   - If OIDC configuration seems correct but still fails
   - Provide workflow logs and npm settings screenshots

---

## References

- **npm OIDC Docs**: <https://docs.npmjs.com/cli/using-npm/configure-npm/configuring-your-npm-client-with-github-actions>
- **GitHub Actions OIDC**: <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect>
- **Provenance Verification**: <https://docs.npmjs.com/generating-provenance-statements>
- **Current Workflow**: [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml)
- **Current Troubleshooting**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#troubleshooting-404-not-found-on-npm-publish)

---

## Completion Checklist

- [ ] Account administrator has configured OIDC on npm
- [ ] GitHub Actions OIDC token is trusted for repository: `CyanAutomation/kaseki-agent`
- [ ] Publish workflow job has been re-run
- [ ] Package is successfully published to npm registry
- [ ] Package metadata verified: `npm view @cyanautomation/kaseki-agent@1.133.1`
- [ ] Documentation updated with setup guide
- [ ] Future releases are configured to use OIDC (no manual intervention needed)
- [ ] Sigstore transparency log has provenance entry
