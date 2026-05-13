# Changelog

All notable changes to Kaseki Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.26.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.4...v1.26.0) (2026-05-13)

### Features

* add bootstrap validation and error handling to API service and scripts ([386cfb7](https://github.com/CyanAutomation/kaseki-agent/commit/386cfb742304104ad05c96196f9bf70ea3958599))

### Bug Fixes

* update string quotes for consistency in error messages and environment variable setup ([59b62c9](https://github.com/CyanAutomation/kaseki-agent/commit/59b62c989a35b4602cc38df77f2d53e5fe648224))
* update trap syntax for temporary file cleanup and add shellcheck disables for clarity ([261504d](https://github.com/CyanAutomation/kaseki-agent/commit/261504d004707f59d66d6220dcfb390ebea2f801))

## [1.25.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.3...v1.25.4) (2026-05-13)

### Bug Fixes

* collapse long PR file lists ([32582fb](https://github.com/CyanAutomation/kaseki-agent/commit/32582fbb9acc658fc33ba1ab4031fdc834bf485c))
* collapse long PR file lists ([#278](https://github.com/CyanAutomation/kaseki-agent/issues/278)) ([37b6455](https://github.com/CyanAutomation/kaseki-agent/commit/37b6455cc8b727560545eb063060c698042ee69b))

## [1.25.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.2...v1.25.3) (2026-05-13)

### Bug Fixes

* derive PR titles with instance suffix ([b868074](https://github.com/CyanAutomation/kaseki-agent/commit/b868074c6215d693abe824489239a1c9af5e9e26))

## [1.25.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.1...v1.25.2) (2026-05-12)

### Bug Fixes

* normalize wrapped github app private keys ([489ccca](https://github.com/CyanAutomation/kaseki-agent/commit/489cccadf354651fd965f1c3faed873e7131d46f))
* normalize wrapped GitHub App private keys ([#249](https://github.com/CyanAutomation/kaseki-agent/issues/249)) ([df54da9](https://github.com/CyanAutomation/kaseki-agent/commit/df54da9a384a7e75cb8018302f9cf3988dec2960))

## [1.25.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.0...v1.25.1) (2026-05-11)

### Bug Fixes

* update logging to use consistent string formatting in validation output filter ([f77778a](https://github.com/CyanAutomation/kaseki-agent/commit/f77778a15d8b470db602f33eece040a6dafba497))

## [1.25.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.6...v1.25.0) (2026-05-11)

### Features

* enhance validation logging with diagnostics and environment details ([3f4c3af](https://github.com/CyanAutomation/kaseki-agent/commit/3f4c3aff3e30c42e2f7a5bedaa4a5e679e9598a1))

## [1.24.6](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.5...v1.24.6) (2026-05-11)

### Bug Fixes

* ensure consistent exit code 0 for validation-output-filter to prevent pipeline failures ([5711e4b](https://github.com/CyanAutomation/kaseki-agent/commit/5711e4b0b8e911ed70cd722462890a19ea3a6c10))

## [1.24.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.4...v1.24.5) (2026-05-11)

### Bug Fixes

* retain devDependencies in Docker image for validation tools ([c2563d4](https://github.com/CyanAutomation/kaseki-agent/commit/c2563d438bbdd61339f84fb07f746a0d91054c59))

## [1.24.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.3...v1.24.4) (2026-05-11)

### Bug Fixes

* ensure filter always exits with code 0 and improve error handling ([a4314aa](https://github.com/CyanAutomation/kaseki-agent/commit/a4314aad134b66353c748ed75769d1b8d3ea2385))

## [1.24.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.2...v1.24.3) (2026-05-11)

### Bug Fixes

* add missing library files to /usr/local/bin/lib in Dockerfile ([e578cdb](https://github.com/CyanAutomation/kaseki-agent/commit/e578cdb0c0d136926086ac92a9bb2b3d08768c1a))

## [1.24.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.1...v1.24.2) (2026-05-11)

### Bug Fixes

* simplify error handling by removing unnecessary error variables in multiple files ([7a0ac82](https://github.com/CyanAutomation/kaseki-agent/commit/7a0ac828cda38913c4d4644a30ed56cb6e654337))

## [1.24.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.0...v1.24.1) (2026-05-11)

### Bug Fixes

* streamline build process by moving TypeScript build step before tests ([6d1922e](https://github.com/CyanAutomation/kaseki-agent/commit/6d1922e7079ab62b862a1cd20ea5035f491a534f))

## [1.24.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.23.0...v1.24.0) (2026-05-11)

### Features

* add validation tests for dist/lib packaging and module imports ([aaa3e76](https://github.com/CyanAutomation/kaseki-agent/commit/aaa3e76afb769e490170725cb69e83132a141760))

### Bug Fixes

* clean up code by removing unnecessary comments and improving error messages ([3765091](https://github.com/CyanAutomation/kaseki-agent/commit/3765091f384a1c5a7874ad19768608e668624b8f))

## [1.23.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.22.0...v1.23.0) (2026-05-11)

### Features

* enhance validation logging by capturing stderr output for diagnostics ([895a070](https://github.com/CyanAutomation/kaseki-agent/commit/895a07099b61aabcc48555f5974241ad4f49e8d7))

### Bug Fixes

* suppress shellcheck warnings for unused variables in test scripts ([aabae68](https://github.com/CyanAutomation/kaseki-agent/commit/aabae6830f37c0c1208ca93c67827f85d105fb91))

## [1.22.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.21.0...v1.22.0) (2026-05-11)

### Features

* integrate unused-imports ESLint plugin and enhance linting rules for better code quality ([023512b](https://github.com/CyanAutomation/kaseki-agent/commit/023512bd72246e7a15a16a0ce9b6f0380bb4ebe5))

### Bug Fixes

* update time check message format for clarity ([4ee5e81](https://github.com/CyanAutomation/kaseki-agent/commit/4ee5e818989ad1cde3364f4b4daca33e2b15188b))

## [1.21.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.20.0...v1.21.0) (2026-05-11)

### Features

* add SIGPIPE exit code handling and improve validation-output-filter error management ([200b0ab](https://github.com/CyanAutomation/kaseki-agent/commit/200b0ab824b1a69f1870186865de454d495d7fe7))

## [1.20.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.19.1...v1.20.0) (2026-05-11)

### Features

* add TypeScript configuration files for project setup ([598df34](https://github.com/CyanAutomation/kaseki-agent/commit/598df3481be09bab3f675c14f9b441d422f72b95))

## [1.19.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.19.0...v1.19.1) (2026-05-11)

### Bug Fixes

* correct printf syntax in validation summary output ([aa0bd87](https://github.com/CyanAutomation/kaseki-agent/commit/aa0bd87505aed58d565d19d7719e5bb4d84dab50))
* update message formatting in heartbeat and summary emission ([066bcc5](https://github.com/CyanAutomation/kaseki-agent/commit/066bcc554b236908e0466702da8455cb09894825))

## [1.19.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.18.0...v1.19.0) (2026-05-11)

### Features

* add validation output filter script and update usage instructions ([d301ee3](https://github.com/CyanAutomation/kaseki-agent/commit/d301ee39c984ff4b00022eb013342bee5a8be8c0))
* implement ToolBatchAggregator for efficient tool call batching and summary emission ([bdbf786](https://github.com/CyanAutomation/kaseki-agent/commit/bdbf78658285ee0ca4c987f38912456a48413e95))

### Bug Fixes

* remove unnecessary blank line before flushing tool batches ([cbf1987](https://github.com/CyanAutomation/kaseki-agent/commit/cbf198734079e2b1abaca0428ae67ea22e24b1c1))

## [1.18.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.17.0...v1.18.0) (2026-05-10)

### Features

* add KASEKI_REPO_MEMORY_ROOT and KASEKI_RESULTS_DIR variables for improved memory management ([3064dbe](https://github.com/CyanAutomation/kaseki-agent/commit/3064dbe22513de081b94073c01f76dd83ae182d6))

### Bug Fixes

* adjust errexit behavior in build_github_skip_reasons and related tests ([94e48aa](https://github.com/CyanAutomation/kaseki-agent/commit/94e48aa1807c3015b9ce43c83b5db30de2b9d1a7))

## [1.17.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.16.0...v1.17.0) (2026-05-10)

### Features

* add validation output filter and integrate with Docker logs ([fce28b7](https://github.com/CyanAutomation/kaseki-agent/commit/fce28b7066e158bbe7217daf797341ef460de936))

### Bug Fixes

* remove unnecessary blank line in processLine function ([1e8d906](https://github.com/CyanAutomation/kaseki-agent/commit/1e8d906faf28696d60804f80846c3419fa99cfb9))

## [1.16.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.15.1...v1.16.0) (2026-05-10)

### Features

* add diagnostic script and monitoring module for GitHub operations failures ([90c0ab2](https://github.com/CyanAutomation/kaseki-agent/commit/90c0ab2c6f1429823b30d242dcb68b722a924c32))
* enable GitHub App operations by default and add credential auto-detection ([3e21a40](https://github.com/CyanAutomation/kaseki-agent/commit/3e21a40c8e7c63530f6cde844105abc94b1a9642))

## [Unreleased]

### Features

* **GitHub App Operations Now Enabled by Default**: `GITHUB_APP_ENABLED` defaults to `1` (enabled) instead of `0` when credentials are available. GitHub operations (PR creation, branch push) are now attempted by default, improving user experience.
* **GitHub App Credential Auto-Detection**: Credentials are automatically discovered from multiple locations in priority order:
  - Environment variables (`GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`)
  - Standard secret paths (`/agents/secrets/github_app_*`, `~/.secrets/github_app_*`)
  - Convenience auto-detect paths (`~/.ssh/github-app-private-key`, `$PWD/.github-app-secrets/private-key`, `/etc/kaseki-secrets/github_app_private_key`)
* **Graceful Credential Degradation**: When `KASEKI_PUBLISH_MODE=auto` (default), missing credentials no longer fail the run—GitHub operations are simply skipped. Strict modes (`branch`, `draft_pr`) still require credentials and fail with exit code 7.

### Documentation

* Added comprehensive GitHub App configuration guide to [docs/ENV_VARS.md](docs/ENV_VARS.md) with default behavior and auto-detection paths
* Updated [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) with credential setup examples and auto-detection priority order

### Backward Compatibility

* **No Breaking Changes**: Existing deployments continue to work. Explicit `GITHUB_APP_ENABLED=0` is always respected.
* **Automatic Enablement**: If GitHub App credentials are present and `KASEKI_PUBLISH_MODE ≠ "none"`, GitHub operations are now enabled automatically (previously required explicit configuration).

## [1.15.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.15.0...v1.15.1) (2026-05-10)

### Bug Fixes

* correct script copy location in Dockerfile for proper build context ([b573517](https://github.com/CyanAutomation/kaseki-agent/commit/b57351713d7f39aeaeda3b976eec6baf10df827e))

## [1.15.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.14.0...v1.15.0) (2026-05-10)

### Features

* add log suppression utilities for improved test output management ([f7830f1](https://github.com/CyanAutomation/kaseki-agent/commit/f7830f152ebb7f985435f8145524a9d2015bf31d))
* enhance GitHub API error handling with retry logic and validation tests ([ecce266](https://github.com/CyanAutomation/kaseki-agent/commit/ecce266cdf1a286227b5395c17af19dcdb663cce))

### Bug Fixes

* remove unnecessary whitespace in log suppression utility documentation ([4ffe0ea](https://github.com/CyanAutomation/kaseki-agent/commit/4ffe0ea666cc0090c619fddae65afa0e2a53f6e0))

## [1.14.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.13.1...v1.14.0) (2026-05-10)

### Features

* add OpenAPI 3.1 specification generation for Kaseki Agent API ([ab11ecc](https://github.com/CyanAutomation/kaseki-agent/commit/ab11ecca0d2f88e7f671e39687c95eec3b004fc0))

### Bug Fixes

* correct logging message format in OpenAPI spec generation script ([daf1a6c](https://github.com/CyanAutomation/kaseki-agent/commit/daf1a6c24f89def51d80cdabd4c9896f781f1f36))

## [1.13.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.13.0...v1.13.1) (2026-05-10)

### Bug Fixes

* improve secret scan logging and streamline artifact availability checks ([72e84cc](https://github.com/CyanAutomation/kaseki-agent/commit/72e84cce2681f7c01e6e374638c4a6a5649d27b4))

## [1.13.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.4...v1.13.0) (2026-05-10)

### Features

* enhance artifact management with comprehensive metadata and inline diagnostics ([c0f6231](https://github.com/CyanAutomation/kaseki-agent/commit/c0f62316856735e1bd3df8222e7c7b549da4d155))
* implement secret scan allowlist mechanism and update documentation ([0a64636](https://github.com/CyanAutomation/kaseki-agent/commit/0a64636f4db6488a47d113665555d4b523680ce7))

### Bug Fixes

* format changelog entries for consistency ([11cc6f2](https://github.com/CyanAutomation/kaseki-agent/commit/11cc6f28b61966c26942d0f7318639518ca6345f))

## [1.12.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.3...v1.12.4) (2026-05-10)

### Bug Fixes

* add ansi-colors.js to installation in Dockerfile ([54b3a06](https://github.com/CyanAutomation/kaseki-agent/commit/54b3a06532c9fce5a023e9e95caa54c579830a6d))

## [1.12.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.2...v1.12.3) (2026-05-10)

### Bug Fixes

* add installation of pi-progress-summarizer.js to Dockerfile ([230c644](https://github.com/CyanAutomation/kaseki-agent/commit/230c6443d4655dabfd43d641163c7787770f3c8a))

## [1.12.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.1...v1.12.2) (2026-05-10)

### Bug Fixes

* add installation of pi-progress-summarizer.js to Dockerfile ([1f35cea](https://github.com/CyanAutomation/kaseki-agent/commit/1f35cea0459862e29fa1516cfd0739c9b73a08b6))

## [1.12.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.0...v1.12.1) (2026-05-10)

### Bug Fixes

* increase KASEKI_AGENT_TIMEOUT_SECONDS to 3600 and update logging options in docker-compose.yml ([0ae9b1f](https://github.com/CyanAutomation/kaseki-agent/commit/0ae9b1fd43aea9b8bdf3592d87b64dd954cc1c61))
* update default values for KASEKI_API_MAX_CONCURRENT_RUNS, KASEKI_AGENT_TIMEOUT_SECONDS, and KASEKI_MAX_DIFF_BYTES in configuration files ([3419ec5](https://github.com/CyanAutomation/kaseki-agent/commit/3419ec590c3878e1795177b82937b3ea2779e222))

## [1.12.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.11.0...v1.12.0) (2026-05-10)

### Features

* add module import validation script and update build process ([f1613a0](https://github.com/CyanAutomation/kaseki-agent/commit/f1613a0ff5c68bd1a9f5d7b1b3bcb4a843cd4a20))
* implement host-based secrets management ([b118f57](https://github.com/CyanAutomation/kaseki-agent/commit/b118f57dc819a0a6592d294df8d66104f4a83185))

## [1.11.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.4...v1.11.0) (2026-05-09)

### Features

* add example environment configuration for Kaseki Agent API service ([ce35063](https://github.com/CyanAutomation/kaseki-agent/commit/ce3506323083015cb48a1f02f8189faefe947c79))

## [1.10.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.3...v1.10.4) (2026-05-09)

### Bug Fixes

* update user ID from 1000 to 10000 across Docker configurations and documentation for consistency ([4f40e21](https://github.com/CyanAutomation/kaseki-agent/commit/4f40e21278ebd0c082817c6e4653feee2e091e50))

## [1.10.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.2...v1.10.3) (2026-05-09)

### Bug Fixes

* update user ID from 10001 to 1000 across Docker configurations and documentation for consistency ([afae0c4](https://github.com/CyanAutomation/kaseki-agent/commit/afae0c476820a06523d9e196bbbabcf5a79503e0))

## [1.10.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.1...v1.10.2) (2026-05-09)

### Bug Fixes

* improve KASEKI_RESULTS_DIR creation error handling and ensure writable permissions ([d655e44](https://github.com/CyanAutomation/kaseki-agent/commit/d655e449acfbddf835e835e3c1b4624e71c18990))

## [1.10.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.0...v1.10.1) (2026-05-09)

### Bug Fixes

* enhance KASEKI_RESULTS_DIR creation with writable permissions and improved error messaging ([fa8f08d](https://github.com/CyanAutomation/kaseki-agent/commit/fa8f08defa177145eb4ffac8dd823df42b1be601))

## [1.10.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.9.0...v1.10.0) (2026-05-09)

### Features

* add comprehensive authentication setup guide and enhance DoctorCommand error handling ([085fd0e](https://github.com/CyanAutomation/kaseki-agent/commit/085fd0e46e26929c09142cf21ad788f8b4a40953))

## [1.9.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.8.1...v1.9.0) (2026-05-09)

### Features

* enhance Docker image checks and error handling in DoctorCommand and DockerManager ([31aa039](https://github.com/CyanAutomation/kaseki-agent/commit/31aa0391cf11bbdb4ddf5b3e5d0062981253f3da))

### Bug Fixes

* improve formatting and add troubleshooting steps in EXIT_CODES documentation ([7a9dce5](https://github.com/CyanAutomation/kaseki-agent/commit/7a9dce563aa22774e0433df50ec67c9de0ab250b))

## [1.8.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.8.0...v1.8.1) (2026-05-09)

### Bug Fixes

* correct formatting in DoctorCommand and RunCommand for better readability ([0bc498c](https://github.com/CyanAutomation/kaseki-agent/commit/0bc498cdef0f7b40dd6ee11b53af303c3108d2c5))

## [1.8.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.7.0...v1.8.0) (2026-05-09)

### Features

* add default values for repo URL, git ref, Docker image, and directories in RunCommand ([9e6c24c](https://github.com/CyanAutomation/kaseki-agent/commit/9e6c24c02d01ed1b436f3b750cacff0d747112fd))

## [1.7.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.6.0...v1.7.0) (2026-05-09)

### Features

* add authentication files validation to DoctorCommand and update RunCommand to check for required files ([266df6d](https://github.com/CyanAutomation/kaseki-agent/commit/266df6d282c666e47c45f8287857511a3359c2b9))

## [1.6.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.5...v1.6.0) (2026-05-09)

### Features

* integrate enquirer for interactive setup prompts ([e52baf9](https://github.com/CyanAutomation/kaseki-agent/commit/e52baf907207d6d519fdada19eb2282c5c0993fb))

## [1.5.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.4...v1.5.5) (2026-05-09)

### Bug Fixes

* add npm build step to publish-npm workflow to ensure dist/ is included in package ([aa47866](https://github.com/CyanAutomation/kaseki-agent/commit/aa4786690ca8a037c359681fd6eb487032643b4f))

## [1.5.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.3...v1.5.4) (2026-05-09)

### Bug Fixes

* add npm build step to release workflow to ensure dist/ is included in published package ([272b852](https://github.com/CyanAutomation/kaseki-agent/commit/272b852dcdd070ac0996df066aac393478a6ab49))

## [1.5.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.2...v1.5.3) (2026-05-09)

### Bug Fixes

* ensure dist/ rebuild with correct dynamic import .js extensions ([1092d1a](https://github.com/CyanAutomation/kaseki-agent/commit/1092d1ab8df48b8cb128771131aadb1a48afecf2))

## [1.5.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.2...v1.5.3) (2026-05-09)

### Bug Fixes

* synchronize the release version across package metadata, lockfile, and changelog
* configure semantic-release to update npm package metadata without publishing
* document npm publish version ownership and log the exact packed version

## [1.5.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.1...v1.5.2) (2026-05-09)

### Bug Fixes

* add always-auth option to npm setup in publish workflow ([c902a52](https://github.com/CyanAutomation/kaseki-agent/commit/c902a52464ea57e77cf3b9f80fdc7d73d39ef80b))
* add diagnostics to publish workflow and ensure NODE_AUTH_TOKEN is unset ([c08e02b](https://github.com/CyanAutomation/kaseki-agent/commit/c08e02b11ebb48e68091de684610f57908b0b242))
* add npm registry configuration step to workflow ([097a7a3](https://github.com/CyanAutomation/kaseki-agent/commit/097a7a339fd484221724ac608b722d216d9a9945))
* configure npm registry URL in setup-node action ([f473468](https://github.com/CyanAutomation/kaseki-agent/commit/f473468d8c5d57f717f6708cf9731f45d3f1ef45))
* downgrade setup-node action to v4 for compatibility ([5f7dce6](https://github.com/CyanAutomation/kaseki-agent/commit/5f7dce6d60ddd6030f6b8a0dfbeeace3871615db))
* revert Node.js engine version requirement to >=22 in package.json ([22dda4e](https://github.com/CyanAutomation/kaseki-agent/commit/22dda4e4a02b3272e4e35ffb8aaf1ce01667863d))
* revert Node.js version to 22.22.2 in npm publish workflow ([e093e83](https://github.com/CyanAutomation/kaseki-agent/commit/e093e83dff3da8e4fcdea461e9d99c5db179c43f))
* robust diagnostics and clean publish environment ([9882cab](https://github.com/CyanAutomation/kaseki-agent/commit/9882cab41244f6462d15ef3014beb916113430ee))
* simplify npm publishing setup by removing unnecessary authentication steps ([b1eef30](https://github.com/CyanAutomation/kaseki-agent/commit/b1eef304556c0731ed5ccaba8875fe05c53ab044))
* simplify repository URL and add publishConfig for OIDC ([fe87444](https://github.com/CyanAutomation/kaseki-agent/commit/fe874447697d688c6ef7a87d4875439305552ab2))
* update Node.js version to 24 in publish workflow ([0424037](https://github.com/CyanAutomation/kaseki-agent/commit/042403788a92182f349f79dc0e3aca5fdd8c30ad))
* update package.json version to match the published version during npm publish ([4ed8055](https://github.com/CyanAutomation/kaseki-agent/commit/4ed805590bd7af5b4ac5b6510460070fdcde4c07))
* update publish workflow for OIDC and bump version to 1.5.1 ([5311458](https://github.com/CyanAutomation/kaseki-agent/commit/531145818c8eb77533ac43478175c237f3a18820))
* update repository URL format in package.json ([3eb54bc](https://github.com/CyanAutomation/kaseki-agent/commit/3eb54bc9a28e054c4aef57299ce73c06d0577247))

## [1.5.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.0...v1.5.1) (2026-05-08)

### Bug Fixes

* enhance npm publish diagnostics and OIDC setup instructions in workflow ([0d78376](https://github.com/CyanAutomation/kaseki-agent/commit/0d78376ff354f3e22a268204c36d657dd122e37b))
* enhance version resolution logic for manual NPM publishing ([6104351](https://github.com/CyanAutomation/kaseki-agent/commit/6104351680d5401543acab206c43c25f54e26fdd))

## [1.5.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.4.1...v1.5.0) (2026-05-08)

### Features

* add GitHub Actions workflow for publishing to NPM ([e0a7e3c](https://github.com/CyanAutomation/kaseki-agent/commit/e0a7e3c6af932536c90a4ae798f0e7d5a6f3f172))
* enhance KASEKI_RESULTS_DIR handling by auto-creating directory and improving error messages ([818b208](https://github.com/CyanAutomation/kaseki-agent/commit/818b208680d7753319bda2d33339740e107562c5))

### Bug Fixes

* correct error message formatting in loadConfig function ([bba3909](https://github.com/CyanAutomation/kaseki-agent/commit/bba3909dc5934f7eb46490af51d0467e668cfe04))
* explicitly include undici in global pi-coding-agent installation to resolve module dependencies ([7137030](https://github.com/CyanAutomation/kaseki-agent/commit/7137030bacb766344f8ddd7f680c114787241600))
* update Docker GitHub Actions to Node.js 24 compatible versions ([0d56415](https://github.com/CyanAutomation/kaseki-agent/commit/0d56415cf72632bd07c9f44c2ad1bb5993c51b7f))
* update package.json to include missing files and add prepublish script ([e01cfdb](https://github.com/CyanAutomation/kaseki-agent/commit/e01cfdb041fbecb4e763a28bf113c5cfa8fd8087))
* update Pi CLI installation to create a wrapper script for proper module resolution ([1cbf744](https://github.com/CyanAutomation/kaseki-agent/commit/1cbf744ff440a9755dbfe4e05ae74b3d45273f66))
* update publish workflow to enhance OIDC trusted publishing and streamline npm authentication ([fa6c729](https://github.com/CyanAutomation/kaseki-agent/commit/fa6c729d1af51a0aaa3367270f2c45b2aadd296d))

## [1.4.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.3.0...v1.4.0) (2026-05-08)

### Features

* add CLI commands for configuration, health checks, instance listing, reporting, execution, secrets management, API service, and setup wizard ([a6ddde6](https://github.com/CyanAutomation/kaseki-agent/commit/a6ddde6371a50352b2f2fdd9e6d89aa13c956286))
* Add Pi Progress Summarizer with enhanced event handling and logging ([7aa8bb9](https://github.com/CyanAutomation/kaseki-agent/commit/7aa8bb974b645cc75c497f3acd0f8e12f1f8a9be))
* Enhance documentation and implement new features for kaseki-agent ([4df2c4b](https://github.com/CyanAutomation/kaseki-agent/commit/4df2c4b8b30a1e05e4eb07785c75ecc44f87f53f))
* Implement list command to display Kaseki instances with filtering and sorting ([9bd47e8](https://github.com/CyanAutomation/kaseki-agent/commit/9bd47e896f56432f5060a59d27c21ad24026e05f))
* Migrate Kaseki Agent to NPM package and enhance documentation ([7e825f4](https://github.com/CyanAutomation/kaseki-agent/commit/7e825f46bf05176ea4eeebce12256166623155ed))
* **validation:** enhance handling of missing npm scripts in validation commands ([1bfe5f8](https://github.com/CyanAutomation/kaseki-agent/commit/1bfe5f8d65aeb7597c88c3faaddad96157463350))

## [1.3.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.2.0...v1.3.0) (2026-05-08)

### Features

* add instance state derivation and metadata reader scripts to the Dockerfile ([b554b33](https://github.com/CyanAutomation/kaseki-agent/commit/b554b33bf28dba4bf49acfb7402a9f718df96374))
* enhance printf safety in github operations; add validation and logging improvements; introduce comprehensive test suite ([fd8457e](https://github.com/CyanAutomation/kaseki-agent/commit/fd8457e897fc0b82fc1ff2afc0e5b4cdf05751d1))
* enhance validation and error handling in json_encode and validate_numeric functions; add comprehensive test suite for printf safety ([7b5c828](https://github.com/CyanAutomation/kaseki-agent/commit/7b5c828c3fa01c4d802220e4f1d26b09ff8c2c3c))

### Bug Fixes

* move coverage variable declaration to the correct scope in restoration summary ([04f5c38](https://github.com/CyanAutomation/kaseki-agent/commit/04f5c384342c7fcd3c5491d8dcaf5a60f31c3763))
* optimize coverage calculation in restoration summary logging ([259d5fa](https://github.com/CyanAutomation/kaseki-agent/commit/259d5fa6673bb8b990b33a4ac20a6ed4e0f41c9e))
* update shellcheck directives for improved script linting ([602d994](https://github.com/CyanAutomation/kaseki-agent/commit/602d9949f5cc6e268984eea05c073b6db0039de8))

## [1.2.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.1.0...v1.2.0) (2026-05-07)

### Features

* enhance error handling in log scanning and centralize error patterns ([c485b40](https://github.com/CyanAutomation/kaseki-agent/commit/c485b405bf8b5f12dd2b26ade127a4494c65ed78))

## [1.1.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.0.1...v1.1.0) (2026-05-07)

### Features

* add extraction functions for validation and quality failure reasons ([f8f8ef3](https://github.com/CyanAutomation/kaseki-agent/commit/f8f8ef3327d90e396cdb3df00bf4b5ed5ab9a834))
* enhance documentation with additional guidance on allowlist patterns and task prompts ([17451da](https://github.com/CyanAutomation/kaseki-agent/commit/17451da713cc4755f450d88fe13e360a7d5721a0))
* enhance error reporting with structured failure reasons and API updates ([8846e9d](https://github.com/CyanAutomation/kaseki-agent/commit/8846e9d2bb1c903793269723de887ee27d3189c7))
* enhance pre-flight validation with comprehensive pattern matching functions and integration tests ([0480bc5](https://github.com/CyanAutomation/kaseki-agent/commit/0480bc5066aa67e3582936d6a4188bd8acb62280))
* Implement comprehensive allowlist restoration system in kaseki-agent ([9367503](https://github.com/CyanAutomation/kaseki-agent/commit/9367503ac3ad1d3dd53afd63bbc8b981665e843e))
* implement fail-fast validation behavior in Kaseki Agent ([d07b28c](https://github.com/CyanAutomation/kaseki-agent/commit/d07b28ccae7215064b43d4ec610b2e4df60abb9c))
* Implement Phase 1 Error Reporting Enhancements ([421390b](https://github.com/CyanAutomation/kaseki-agent/commit/421390b7ab063cc8839116c4b9de37c2d0806d04))
* remove trigger for Docker build workflow after release ([99ed6c5](https://github.com/CyanAutomation/kaseki-agent/commit/99ed6c5d03a161ba0eda5a6c792e27bb10849b3b))

## [1.0.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.0.0...v1.0.1) (2026-05-07)

### Bug Fixes

* disable PR comments in semantic-release to avoid permission errors ([0701e3e](https://github.com/CyanAutomation/kaseki-agent/commit/0701e3ebf6042a2999102c6cae19c1c7f33dee4c))

## 1.0.0 (2026-05-07)

### Features

* add artifact, log, status, and webhook routes ([d592e12](https://github.com/CyanAutomation/kaseki-agent/commit/d592e129038fac33cb7541e77e1776baf30edfa9))
* Add comprehensive implementation summary for Kaseki Agent API service ([bad4d94](https://github.com/CyanAutomation/kaseki-agent/commit/bad4d94fccc0bc5feab07c64def7a41a897ca7f8))
* add kaseki-cli command-line interface and demo ([0d2a566](https://github.com/CyanAutomation/kaseki-agent/commit/0d2a566156b15fae950c8115d4591236eb3763bf))
* Add post-implementation verification checklist for Kaseki Agent ([bb5e8ad](https://github.com/CyanAutomation/kaseki-agent/commit/bb5e8ad8d441e81781e421d248cbc0e4ff040b54))
* add semantic release configuration and changelog ([d77a35a](https://github.com/CyanAutomation/kaseki-agent/commit/d77a35ab7eb6f2ccbe9676b227223764a55bef74))
* add test utilities and validation tests for PreFlightValidator and configuration loading ([47bbed6](https://github.com/CyanAutomation/kaseki-agent/commit/47bbed69ad13351b804dc417fe7f3e6c831acc0f))
* Implement EventCounterAggregator for event stream processing ([be990ac](https://github.com/CyanAutomation/kaseki-agent/commit/be990ace9b16924c706b09070f0a986883d46686))
* Implement idempotency support and pre-flight validation for job submissions ([d5e0592](https://github.com/CyanAutomation/kaseki-agent/commit/d5e05923ddd3596c471ac86ff867f25cefa92e39))
* Implement Kaseki API client and service ([c779c9e](https://github.com/CyanAutomation/kaseki-agent/commit/c779c9e27ff09c2bc621019f883e026ced45732a))
* migrate project to TypeScript and update testing framework ([9309bdc](https://github.com/CyanAutomation/kaseki-agent/commit/9309bdc551c76841c61f60dcf481b6bcbceb2a7b))
* Refactor and expand public API exports, add job lookup middleware, and implement utility functions ([74dfd62](https://github.com/CyanAutomation/kaseki-agent/commit/74dfd62f442dfa58b97fd201994f4fb9f539d4ce))

### Bug Fixes

* Adjust formatting in verification checklist for clarity ([e028619](https://github.com/CyanAutomation/kaseki-agent/commit/e0286191e1d9056264d10339c7f619658d16fa64))
* correct regex pattern for matching imports in add-js-extensions script ([4cbe203](https://github.com/CyanAutomation/kaseki-agent/commit/4cbe2031a7364022463ac10bf2f030e1ca140b12))
* Correct regex pattern for matching imports in add-js-extensions.ts ([38fb48a](https://github.com/CyanAutomation/kaseki-agent/commit/38fb48a16c5ad869dc5efe36b1f906d7910a70d9))
* correct regex pattern for matching imports without extensions ([79bdabe](https://github.com/CyanAutomation/kaseki-agent/commit/79bdabe0a744bf7568c1af68f2dc91af76e532f1))
* correct regex pattern for matching relative imports in add-js-extensions script ([fb8f509](https://github.com/CyanAutomation/kaseki-agent/commit/fb8f509ea05a1bc460f4caa29e1113069bf00c81))
* disable no-explicit-any rule in TypeScript ESLint configuration ([ed905cb](https://github.com/CyanAutomation/kaseki-agent/commit/ed905cb7e8ef937989bc0ccfa5f56c6ce4d3a58c))
* Update readFileSync mock handling and improve instance stage resolution logic ([7e5afb8](https://github.com/CyanAutomation/kaseki-agent/commit/7e5afb87b2ab9fa808b3af9daad7c563dc48800d))

## [Unreleased]

### Features

### Bug Fixes

### Documentation

### Performance Improvements

---

## [0.1.0] - 2026-05-07

### Features

* Initial release of Kaseki Agent ephemeral coding-agent runner
* Multi-stage Docker build with dependency caching
* OpenRouter API integration for Pi CLI coding agents
* GitHub Actions workflow for multi-arch image builds (amd64 + arm64)
* Quality gates: diff size limits, changed-file allowlist, secret scanning
* Kaseki CLI for monitoring and analyzing runs
* Kaseki API service for job scheduling and webhook management
* Comprehensive logging and result artifacts

### Bug Fixes

### Documentation

* Complete README with usage examples
* Contributing guidelines for prompt changes and test expectations
* Deployment documentation for Docker Compose and Node.js
* Development workflow guide
* API documentation and CLI reference

[Unreleased]: https://github.com/CyanAutomation/kaseki-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CyanAutomation/kaseki-agent/releases/tag/v0.1.0
