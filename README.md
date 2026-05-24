# Kaseki Agent

Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run creates a numbered, disposable container instance (kaseki-1, kaseki-2, etc.) that orchestrates the Pi coding-agent with OpenRouter.

## Quick Start

### 1. Install Setup

```bash
# Global install (recommended)
npm install -g @cyanautomation/kaseki-agent

# One-command setup with auto-detection
kaseki-agent init
```

Or use Docker:
```bash
docker run -it docker.io/cyanautomation/kaseki-agent:latest init
```

### 2. Configure Authentication

The setup wizard will guide you through providing:
- **OpenRouter API Key** (required): `sk-or-...`
- **GitHub App Credentials** (optional): App ID, Client ID, Private Key

### 3. Run Your First Task

```bash
# Start API service (Docker Compose recommended)
docker-compose up -d

# Submit a task
kaseki-agent run https://github.com/CyanAutomation/crudmapper main \
  "Add input validation to all POST endpoints"
```

### 4. Monitor Results

```bash
# List all instances
kaseki-agent list

# Get detailed report
kaseki-agent report kaseki-1

# Live monitoring
kaseki-agent status kaseki-1
```

---

## Overview

Kaseki provides three deployment patterns:

- **NPM CLI**: Admin/helper workflows and task clients
- **Docker**: Containerized execution without host Node.js  
- **REST API**: Local/distributed orchestration via `kaseki-agent serve`

Each task execution produces isolated workspace and results for reproducible AI coding workflows.

---

## Installation

### Global NPM (Recommended)
```bash
npm install -g @cyanautomation/kaseki-agent
```

### Local NPM
```bash
npm install @cyanautomation/kaseki-agent
npx kaseki-agent init
```

### Docker
```bash
docker run -it docker.io/cyanautomation/kaseki-agent:latest init
```

---

## Basic Usage

### CLI Commands
- `kaseki-agent init` - Interactive setup wizard
- `kaseki-agent doctor` - Health check and diagnostics
- `kaseki-agent run [repo] [ref] [prompt]` - Execute coding task
- `kaseki-agent list` - List all instances
- `kaseki-agent report [instance]` - Detailed results
- `kaseki-agent status [instance]` - Live status monitoring
- `kaseki-agent serve` - Start local API service

### Task Execution
```bash
# Basic task
kaseki-agent run https://github.com/owner/repo main "Fix TypeScript errors"

# With custom API URL
KASEKI_API_URL=http://localhost:8080/api \
  kaseki-agent run https://github.com/owner/repo main "Add unit tests"

# Monitor progress
kaseki-agent status kaseki-1 --follow
```

---

## Configuration

### Authentication
- **Config file** (recommended): `~/.kaseki/config.json`
- **Environment variables**: `OPENROUTER_API_KEY_FILE`, `GITHUB_APP_*_FILE`
- **Docker secrets**: Mount `/secrets` volume

### Environment Variables
See [docs/ENV_VARS.md](docs/ENV_VARS.md) for complete configuration reference.

### Deployment Options
- **Docker Compose**: Production deployment with persistent API
- **Single-run**: Ephemeral execution for CI/CD
- **Local API**: Development and testing

---

## API Reference

### REST API
Start local API service:
```bash
kaseki-agent serve --port 8080
```

### Programmatic Usage
- **Live monitoring**: Query running instances
- **Error detection**: Identify failures and anomalies  
- **Post-run analysis**: Detailed result summaries
- **Log streaming**: Real-time log consumption

See [docs/API.md](docs/API.md) and [docs/CLI.md](docs/CLI.md) for complete API and CLI documentation.

---

## Architecture

Kaseki orchestrates ephemeral coding-agent instances with:

- **Host layer**: Workspace management, credential resolution, Docker runtime
- **Container layer**: Git cloning, dependency caching, Pi agent invocation  
- **Result layer**: Artifact collection, validation gates, quality metrics
- **API layer**: REST service for external orchestration

Each run produces isolated workspace with:
- Repository clone at target ref
- Node.js dependency cache
- Pi agent execution
- Validation and quality gates
- Comprehensive result artifacts

---

## Resources

### Documentation
- [Quick Start Guide](docs/QUICK_START.md) - Step-by-step setup
- [CLI Reference](docs/CLI.md) - Command-line monitoring tools
- [API Documentation](docs/API.md) - REST API specification
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [Environment Variables](docs/ENV_VARS.md) - Configuration reference
- [Advanced Configuration](docs/ADVANCED_CONFIG.md) - Detailed setup options
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

### Community
- **Issues**: [GitHub Issues](https://github.com/CyanAutomation/kaseki-agent/issues)
- **Discussions**: GitHub Discussions
- **Updates**: Follow for releases and announcements

---

## License

MIT License - see [LICENSE](LICENSE) for details.

**CyanAutomation** - Building reliable AI coding workflows