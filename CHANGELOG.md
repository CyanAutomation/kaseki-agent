# Changelog

All notable changes to Kaseki Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
