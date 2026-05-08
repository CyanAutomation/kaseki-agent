# Changelog

All notable changes to Kaseki Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Initial release of Kaseki Agent ephemeral coding-agent runner
- Multi-stage Docker build with dependency caching
- OpenRouter API integration for Pi CLI coding agents
- GitHub Actions workflow for multi-arch image builds (amd64 + arm64)
- Quality gates: diff size limits, changed-file allowlist, secret scanning
- Kaseki CLI for monitoring and analyzing runs
- Kaseki API service for job scheduling and webhook management
- Comprehensive logging and result artifacts

### Bug Fixes

### Documentation
- Complete README with usage examples
- Contributing guidelines for prompt changes and test expectations
- Deployment documentation for Docker Compose and Node.js
- Development workflow guide
- API documentation and CLI reference

[Unreleased]: https://github.com/CyanAutomation/kaseki-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CyanAutomation/kaseki-agent/releases/tag/v0.1.0
