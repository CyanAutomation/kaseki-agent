# NPM Publishing Fix Plan

**Issue Date**: 2026-09-18  
**Issue Type**: OIDC Trusted Publishing Configuration  
**Exit Code**: 404 Not Found on npm publish

## Problem Analysis

### Root Cause
The npm account (`@cyanautomation` organization) is **not configured for OIDC trusted publishing**. When the GitHub Actions Release workflow attempts to publish the package, it fails because:

1. **OIDC Token Exchange Fails**: 
   - Error: "OIDC token exchange error - package not found"
   - The npm registry cannot accept the GitHub Actions OIDC token from the workflow
   
2. **Package PUT Fails with 404**:
   - npm publish tries to PUT to: `https://registry.npmjs.org/@cyanautomation%2fkaseki-agent`
   - Returns 404 Not Found because the package doesn't exist AND OIDC credentials aren't valid
   - This is a first-publish scenario, not a permission issue on an existing package

3. **Missing GitHub Actions OIDC Configuration**:
   - npm settings at [npmjs.com/settings/cyanautomation/access](https://npmjs.com/settings/cyanautomation/access) have NOT been configured to allow GitHub Actions OIDC tokens
   - The workflow config in `publish-npm.yml` already has the correct setup (registry-url, provenance, etc.), but npm is not accepting the tokens

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

#### Steps:

1. **Log in to npm**:
   - Go to [npmjs.com](https://npmjs.com)
   - Sign in as owner of `@cyanautomation` organization

2. **Navigate to GitHub Actions Settings**:
   - Go to [npm settings → Access & Tokens](https://npmjs.com/settings/cyanautomation/access)
   - OR: Settings → [Github Actions](https://npmjs.com/settings/cyanautomation/github-actions)

3. **Configure OIDC for the Repository**:
   - Click "Authorize GitHub Actions" or "Configure GitHub Actions"
   - Select repository: `CyanAutomation/kaseki-agent`
   - Grant permissions:
     - Package publish
     - Package management
   - Confirm authorization

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

#### Steps:

1. **Find the failed workflow run**:
   - GitHub repository → Actions → "Release" workflow
   - Find the run dated 2026-09-18
   - Note the run number

2. **Re-run the publish job**:
   - Open the failed "publish_npm" job
   - Click "Re-run failed jobs" (or "Re-run all jobs" to be thorough)
   - Wait for the workflow to complete

3. **Monitor the new attempt**:
   - OIDC token exchange should now succeed
   - npm publish should complete with status 200/201
   - Provenance statement should be generated and published to sigstore

4. **Verify publication**:
   - Once workflow succeeds, check npm registry:
     ```bash
     npm view @cyanautomation/kaseki-agent@1.133.1
     ```
   - Should return package information (not 404)
   - Registry indexing may take 30-60 seconds; script will retry automatically

### Phase 4: Documentation & Prevention

**Owner**: Release/docs maintainer  
**Time**: ~15 minutes

#### Updates Needed:

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
- [ ] Package `@cyanautomation/kaseki-agent@1.133.1` is available on npm registry
- [ ] `npm view @cyanautomation/kaseki-agent@1.133.1` returns package metadata
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
|-------|------|----------|-------|
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

- **npm OIDC Docs**: https://docs.npmjs.com/cli/using-npm/configure-npm/configuring-your-npm-client-with-github-actions
- **GitHub Actions OIDC**: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- **Provenance Verification**: https://docs.npmjs.com/generating-provenance-statements
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
