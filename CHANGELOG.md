# Changelog

All notable changes to Kaseki Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
