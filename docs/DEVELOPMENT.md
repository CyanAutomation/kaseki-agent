# Kaseki API Service - Development Guide

## Architecture Overview

The Kaseki API Service provides HTTP REST endpoints for remote control of kaseki-agent runs. It wraps existing kaseki-agent infrastructure and adds HTTP layer, job queue management, and result caching.

```
┌──────────────────────────┐
│ External Client (e.g. OpenClaw)       │
└────────────────┬─────────────────────┘
                 │ HTTP REST + Bearer Auth
     ┌───────────▼──────────────────┐
     │ Express HTTP Server          │
     │ (kaseki-api-service.ts)      │
     └────────────┬─────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
    ┌───▼────────┐   ┌──────▼──────────┐
    │ Job Queue  │   │ Result Cache    │
    │ Scheduler  │   │ (resultcache.ts)│
    │ (job-      │   └─────────────────┘
    │ scheduler) │
    └───┬────────┘
        │
    ┌───▼──────────────────────────┐
    │ kaseki-activate.sh           │
    │ (spawn child process)        │
    └───┬──────────────────────────┘
        │
    ┌───▼──────────────────────────┐
    │ Docker Container             │
    │ (kaseki-agent.sh runs)       │
    └──────────────────────────────┘
```

## Key Components

### 1. Types & Validation (`src/kaseki-api-types.ts`, ~150 lines)

Defines TypeScript interfaces and Zod validation schemas:
- `RunRequest` — Request to trigger a job
- `StatusResponse` — Job status with progress
- `AnalysisResponse` — Comprehensive result summary
- `Job` — Internal job state representation

Uses Zod for runtime validation of incoming requests.

### 2. Configuration (`src/kaseki-api-config.ts`, ~128 lines)

Loads and validates environment variables:
- API keys (from env or file)
- Port, concurrency limits, timeouts
- Directory paths
- Log level

Provides `loadConfig()` and `validateApiKey()` functions.

### 3. Job Scheduler (`src/job-scheduler.ts`, ~195 lines)

Manages in-memory FIFO queue with concurrency control:
- `submitJob()` — Add to queue
- `getJob()` / `listJobs()` — Query state
- Spawns `kaseki-activate.sh` when job runs
- Handles timeouts, failure parsing
- Graceful shutdown via `shutdown()`

Key features:
- Auto-generates unique instance IDs (kaseki-1, kaseki-2, ...)
- Respects max concurrent limit
- Traps exit codes and categorizes failures

### 4. Result Cache (`src/result-cache.ts`, ~65 lines)

Lazy-loads and caches artifacts to reduce filesystem reads:
- `getOrLoad(filePath)` — Load file or return cached
- TTL-based expiration (default: 5 min)
- Memory limit and LRU eviction
- Per-job cleanup

Configured: max 20 entries, 10 MB per file.

### 5. API Routes (`src/kaseki-api-routes.ts`, ~370 lines)

Express route handlers grouped by feature:

**Core Endpoints:**
- `POST /api/runs` — Submit job (202 Accepted)
- `GET /api/runs` — List all recent runs
- `GET /api/runs/:id/status` — Poll status + progress
- `GET /api/runs/:id/analysis` — Comprehensive summary

**Artifact Access:**
- `GET /api/results/:id/:file` — Download diffs, metadata
- `GET /api/runs/:id/logs/:logtype` — Access logs

**Health:**
- `GET /health` — No-auth health check

**Middleware:**
- Bearer token validation (skip for `/health`)
- RFC 7807 error responses
- Request validation via Zod

### 6. Express Service (`src/kaseki-api-service.ts`, ~67 lines)

Main entry point:
- Loads config and validates
- Creates Express app with JSON middleware
- Initializes job scheduler and routes
- Graceful shutdown on SIGTERM/SIGINT
- Unhandled error trapping

### 7. TypeScript Client (`src/kaseki-api-client.ts`, ~200 lines)

High-level client library for integration:
- `submit(request)` — Trigger job
- `getStatus(runId)` — Poll status
- `getAnalysis(runId)` — Full summary
- `getLog(runId, type)` — Retrieve logs
- `getArtifact(runId, file)` — Download artifacts
- `waitForCompletion(runId)` — Poll until done
- `createKasekiClient()` — Factory helper

## Development Workflow

### Build

```bash
npm install
npm run build      # TypeScript → dist/
npm run type-check  # TypeScript validation
```

### Test

```bash
npm run test:unit -- src/result-cache.test.ts      # Run a single Jest test file
npm run test:unit -- -t "caches successful result" # Run tests matching a name pattern
npm run test:ci                                     # Full CI-style validation (build + type-check + jest + bash tests)
npm run test:watch                                  # Jest watch mode
npm run test:coverage                               # Coverage report
```

### Lint

```bash
npm run lint       # Run all linters
npm run lint:js    # ESLint only
npm run lint:fix   # Auto-fix issues
```

### Local Development

```bash
# Terminal 1: Start API
KASEKI_API_KEYS=sk-dev npm run kaseki-api

# Terminal 2: Test endpoints
curl -H "Authorization: Bearer sk-dev" http://localhost:8080/api/health

# Terminal 3: Submit a run (requires actual kaseki-agent setup)
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer sk-dev" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/you/repo"}'
```

## Testing Strategy

### Unit Tests (`src/*.test.ts`)

- **Kaseki API Configuration:** Config loading, validation, API key parsing
- **Request Validation:** Zod schema validation, error cases
- **Job Scheduler:** Queue operations, job submission, timeout handling
- **Result Cache:** Caching, TTL, eviction, cleanup

### Integration Tests (`test/kaseki-api.integration.test.sh`)

Currently placeholder (requires Docker + kaseki-agent setup).

Example test flow:
1. Start API service
2. Verify health check
3. Submit a real run
4. Poll until completion
5. Verify artifacts exist

### End-to-End Tests

Manual testing via TypeScript client:

```typescript
const client = new KasekiApiClient('http://localhost:8080', 'sk-dev');
const run = await client.submit({ repoUrl: '...' });
const final = await client.waitForCompletion(run.id);
console.log(final.status === 'completed' ? 'SUCCESS' : 'FAILED');
```

## Security Considerations

1. **API Key Management**
   - Keys stored in env (dev) or secure file (prod)
   - Never logged or included in responses
   - Bearer token validation on all protected endpoints
   - Validateable against list of approved keys

2. **Input Validation**
   - All external inputs validated via Zod schemas
   - URL format validation
   - File path sanitization
   - Enum validation for task modes

3. **Output Sanitization**
   - RFC 7807 error format (no internal details)
   - Log files truncated if >100 KB
   - Artifact size limits enforced

4. **Concurrency Safety**
   - In-memory queue (single process)
   - No race conditions on job state
   - Atomic timeout handling

## Performance Tuning

### Job Queue

```typescript
// In src/kaseki-api-config.ts
KASEKI_API_MAX_CONCURRENT_RUNS = 3;  // Increase for more parallelism
```

Monitor via:
```bash
curl -H "Authorization: Bearer ..." http://localhost:8080/api/runs
```

### Result Cache

```typescript
// In src/kaseki-api-routes.ts
const cache = new ResultCache(20, 5 * 60 * 1000);  // 20 entries, 5 min TTL
```

Check stats:
```typescript
const stats = cache.getStats();
console.log(`${stats.entries} cached, ${stats.bytes} bytes`);
```

### Database (Future)

Current in-memory design sufficient for <100 recent runs. For persistence across restarts, add:
- SQLite or JSON file-based run log
- Cleanup job for old artifacts
- Run history API endpoint

## Common Development Tasks

### Add a New Endpoint

1. Define request/response types in `src/kaseki-api-types.ts`
2. Add validation schema (if request body expected)
3. Implement handler in `src/kaseki-api-routes.ts`
4. Add tests to `src/kaseki-api-service.test.ts`
5. Document in `docs/API.md`

Example:

```typescript
// 1. Types
export interface MyResponse {
  data: string;
}

// 2. Route
router.get('/my-endpoint', (req, res) => {
  const response: MyResponse = { data: '...' };
  res.json(response);
});

// 3. Test
test('my-endpoint returns data', () => {
  // ...
});
```

### Add Configuration Option

1. Update `KasekiApiConfig` interface in `src/kaseki-api-config.ts`
2. Add env var parsing in `loadConfig()`
3. Add validation and defaults
4. Update `docs/DEPLOYMENT.md`
5. Add test case

### Improve Error Handling

Current pattern using `sendErrorResponse(res, status, title, detail)` follows RFC 7807.

To add new error type:
```typescript
// In route handler
if (someCondition) {
  return sendErrorResponse(res, 422, 'Unprocessable Entity', 
    'Helpful error message here');
}
```

## Debugging

### Enable Debug Logging

```bash
KASEKI_API_LOG_LEVEL=debug npm run kaseki-api
```

### Inspect Job State

Connect to running service and query:
```bash
curl -H "Authorization: Bearer sk-key" http://localhost:8080/api/runs | jq .
```

### Test Job Spawning

Add test repo and try to trigger a run:
```bash
# (Requires actual kaseki-agent, docker, OpenRouter API key setup)
```

### Memory Leaks

Monitor long-running service:
```bash
# In another terminal
watch -n1 'ps aux | grep node'
```

Check cache stats periodically:
```typescript
// In application
setInterval(() => {
  const stats = cache.getStats();
  console.log('Cache:', stats);
}, 60000);
```

## Roadmap

### Current (v1)

- [x] HTTP REST API with Bearer auth
- [x] Job queue with concurrency control
- [x] Result caching
- [x] TypeScript client library
- [x] Comprehensive tests
- [x] Docker & systemd deployment

### Future (v2+)

- [ ] WebSocket for real-time progress updates
- [ ] Persistent run history (SQLite)
- [ ] Prometheus metrics endpoint
- [ ] Rate limiting per API key
- [ ] Multi-host load balancing
- [ ] Run cancellation API
- [ ] Webhook callbacks on completion
- [ ] OpenAPI 3.0 spec auto-generation

## Useful Resources

- Express.js docs: https://expressjs.com/
- Zod validation: https://zod.dev/
- TypeScript handbook: https://www.typescriptlang.org/docs/
- RFC 7807 (Problem Details): https://tools.ietf.org/html/rfc7807
