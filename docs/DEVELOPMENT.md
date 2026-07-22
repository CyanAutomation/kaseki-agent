# Kaseki Agent - Development Guide

This guide provides an overview of the Kaseki Agent architecture for developers working on the codebase.

## Architecture Overview

Kaseki Agent is an ephemeral coding-agent runner that:
1. Spins up a disposable Docker container
2. Clones a target Git repository inside it
3. Invokes the Pi CLI coding agent via OpenRouter
4. Runs validation commands
5. Collects artifacts and produces reports

```
┌─────────────────────────────────────────────────────────────┐
│ External Client (Web UI, CLI, CI/CD, etc.)                  │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP REST + Bearer Auth (API Service)
            ┌─────────▼─────────────────────────────────────┐
            │ Kaseki API Service                           │
            │ └─ Job Queue Management                      │
            │ └─ Result Caching                           │
            │ └─ REST Endpoints                            │
            └────────────┬───────────────────────────────────┘
                        │
            ┌────────────▼───────────────────────────────────┐
            │ Agent Execution                               │
            │ └─ kaseki-agent.sh (spawned in container)    │
            │ └─ Docker Container (ephemeral)              │
            │ └─ Pi CLI Invocation                         │
            │ └─ Validation & Quality Gates                │
            └─────────────────────────────────────────────────┘
```

## Core Components

### 1. CLI Interface (`src/cli/`)
**Entry point for all user interactions**

- **`kaseki-agent init`** - Interactive setup wizard
- **`kaseki-agent run`** - Execute single runs
- **`kaseki-agent serve`** - Start API service
- **`kaseki-agent status`** - Monitor running jobs
- **`kaseki-agent doctor`** - Health checks

### 2. API Service (`src/kaseki-api-*.ts`)
**HTTP REST API for remote control**

- **Endpoints**: `/api/runs`, `/api/runs/:id/status`, `/api/runs/:id/analysis`
- **Authentication**: Bearer token validation
- **Job Queue**: FIFO with concurrency control
- **Result Cache**: Lazy-loading with TTL expiration
- **Type Safety**: Zod validation + TypeScript interfaces

### 3. Agent Runner (`kaseki-agent.sh`)
**Containerized execution engine**

- **Environment Setup**: Node.js v24, Docker, dependencies
- **Repository Management**: Clone, checkout, reset
- **Pi CLI Integration**: Invoke coding agent with timeout
- **Validation Pipeline**: Execute user-defined commands
- **Artifact Collection**: Git diffs, logs, metadata, reports

#### Scouting and Weaving Phases

Kaseki performs a read-only repository analysis before agent execution, writing findings exclusively to `/results/scouting.json` without modifying source files. The scouting run explores codebase patterns and requirements, generating planning data for subsequent transformation. Weaving processes scouting JSON outputs into agent execution instructions, translating research findings into actionable task prompts and structured guidance for the Pi CLI coding agent.

### 4. Setup System (`src/setup/`)
**Configuration and initialization**

- **Environment Detection**: Auto-detect Docker, Node.js, permissions
- **Setup Wizard**: Interactive configuration with validation
- **Secret Management**: Secure credential storage (~/.kaseki/)
- **Template System**: Auto-initialize workspace templates

### 5. Quality Gates (`src/quality/`)
**Automated validation and filtering**

- **Diff Size Limits**: Configurable maximum change size
- **File Allowlists**: Pattern-based restoration of approved changes
- **Secret Scanning**: Detect and handle credential leaks
- **Validation Commands**: Execute user-defined checks
- **Exit Codes**: Structured error reporting

### 6. Utilities (`src/utils/`, `scripts/`)
**Supporting tools and scripts**

- **Progress Streaming**: Real-time Pi event filtering
- **Report Generation**: Markdown summaries and structured data
- **CLI Monitoring**: External agent integration
- **Validation Helpers**: Test running, allowlist management
- **Docker Integration**: Container lifecycle management

## Development Workflow

### Setup Development Environment

```bash
# Clone and install dependencies
git clone <repo>
cd kaseki-agent
npm install

# Build TypeScript
npm run build

# Run type checking
npm run type-check

# Run tests
npm run test:unit
npm run test:ci  # Full CI validation
```

### Key Development Commands

```bash
# Development server (watch mode)
npm run dev

# Lint and fix issues
npm run lint:fix

# Run specific test file
npm run test:unit -- src/result-cache.test.ts

# Validate module imports (Docker dependencies)
npm run validate-module-imports

# Build Docker image
docker build -t kaseki-agent:latest .

# Run smoke tests
npm run test:smoke
```

### Adding New Features

#### 1. New CLI Command
1. Add command class in `src/cli/commands/`
2. Register in `src/cli/KasekiCLI.ts`
3. Add tests and documentation
4. Update help text

#### 2. New API Endpoint
1. Define types in `src/kaseki-api-types.ts`
2. Add validation schema (if needed)
3. Implement handler in `src/kaseki-api-routes.ts`
4. Add route registration
5. Write unit tests
6. Update API documentation

#### 3. New Quality Gate
1. Implement logic in `src/quality/`
2. Add configuration option
3. Update exit code handling
4. Add tests
5. Document in QUALITY_GATES.md

#### 4. New Utility Module
1. Add TypeScript file in `src/utils/`
2. Build project: `npm run build`
3. Validate dependencies: `npm run validate-module-imports`
4. Add to Dockerfile if needed
5. Write tests

### Testing Strategy

#### Unit Tests
- **Component Tests**: Isolated testing of individual modules
- **Configuration Tests**: Environment variable parsing and validation
- **Queue Tests**: Job scheduling and timeout handling
- **Cache Tests**: Result caching and eviction logic

#### Integration Tests
- **API Tests**: HTTP endpoint validation
- **CLI Tests**: Command-line interface testing
- **Docker Tests**: Container lifecycle and execution
- **End-to-End Tests**: Full workflow validation

#### Test Commands
```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage

# CI-style validation
npm run test:ci
```

### Configuration Management

The system uses environment variables with sensible defaults:

- **Development**: `.env` file with development settings
- **Production**: Environment variables or secret files
- **Docker**: Build args and runtime env vars

Key configuration files:
- `.env.template` - Essential 8 variables
- `.env.advanced.template` - Complete variable reference
- `src/kaseki-api-config.ts` - Configuration loading and validation

### Code Style and Quality

#### TypeScript
- Strict mode enabled
- Interface-heavy design
- Type guards for runtime validation
- Generic types for reusable components

#### JavaScript
- ES2024 features with Node.js v24 target
- Async/await throughout
- Error handling with try/catch
- Logging with structured JSON

#### Testing
- Jest for unit tests
- Mock external dependencies
- Test environment isolation
- Coverage thresholds enforced

### Debugging

#### Development Logging
```bash
# Enable debug logging
KASEKI_API_LOG_LEVEL=debug npm run kaseki-api

# Verbose CLI output
kaseki-agent --verbose run ...

# Docker container debugging
docker logs kaseki-1
```

#### Common Debug Scenarios

**Job Queue Issues**
```bash
# Check job state via API
curl -H "Authorization: Bearer sk-key" \
  http://localhost:8080/api/runs | jq .

# Monitor job spawning
ps aux | grep kaseki-agent
```

**Module Import Problems**
```bash
# Validate Docker dependencies
npm run validate-module-imports

# Check built files
ls -la dist/
```

**Configuration Issues**
```bash
# Test configuration loading
node -e "console.log(require('./src/kaseki-api-config').loadConfig())"

# Check environment setup
./scripts/startup-checks.sh
```

## Release Process

Kaseki Agent uses semantic-release for automated versioning:

1. **Conventional Commits**: Use `feat:`, `fix:`, `perf:` prefixes
2. **Version Bumps**: Automatic based on commit types
3. **Changelog**: Auto-generated and updated
4. **GitHub Releases**: Automated creation with release notes
5. **Docker Builds**: Multi-arch images triggered automatically

```bash
# Dry-run release preview
npm run release:dry

# Create actual release
npm run release
```

## Deployment Architecture

### Development
- Direct Node.js execution
- Hot reload with `npm run dev`
- Local Docker testing

### Production
- **Recommended**: Docker Compose with API service
- **Alternative**: Systemd service with Node.js
- **Scaling**: Multiple instances with load balancing
- **Monitoring**: Health checks and metrics endpoints

### Infrastructure
- **Docker**: Multi-stage builds, security scanning
- **CI/CD**: GitHub Actions with caching
- **Security**: Trivy scanning, SBOM generation
- **Monitoring**: Built-in health checks and metrics

## Contributing

### Development Guidelines
1. Follow TypeScript strict mode
2. Write comprehensive tests
3. Use conventional commits
4. Update documentation for new features
5. Test both CLI and API interfaces
6. Validate Docker dependencies

### Quality Standards
- **Code Coverage**: Minimum 80% test coverage
- **Type Safety**: No `any` types, strict null checks
- **Error Handling**: Proper error propagation and logging
- **Documentation**: JSDoc for all public APIs
- **Performance**: Monitor memory usage and execution time

### Common Issues to Avoid
- Missing Docker dependency validation
- Inadequate error handling in async operations
- Hardcoded paths or environment assumptions
- Missing configuration validation
- Incomplete test coverage for edge cases

## Useful Resources

### Documentation
- **[API.md](./API.md)** - Complete API reference
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Production deployment guide
- **[QUALITY_GATES.md](./QUALITY_GATES.md)** - Quality validation system
- **[CLI.md](./CLI.md)** - Command-line interface documentation

### External Links
- **Express.js**: <https://expressjs.com/>
- **Zod**: <https://zod.dev/>
- **TypeScript**: <https://www.typescriptlang.org/>
- **Docker**: <https://docs.docker.com/>
- **GitHub Actions**: <https://docs.github.com/actions>

### Community
- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: GitHub Discussions for questions and ideas
- **Contributing**: See CONTRIBUTING.md for guidelines