# Feature 3: Code Summarization Module

## Quick Start

### Using Feature 3 in TypeScript

```typescript
import { readFileWithSummaryAndMetrics } from './summarization/read-wrapper';

// Read a TypeScript file with optional summarization
const result = await readFileWithSummaryAndMetrics('/path/to/service.ts');

if (result?.metrics) {
  console.log(`Strategy: ${result.metrics.strategy}`);
  console.log(`Language: ${result.metrics.language}`);
  console.log(`Compression: ${result.metrics.compressionRatio.toFixed(2)}:1`);
  console.log(`Tokens saved: ${result.metrics.estimatedTokensSaved}`);
}

// Force full read
const fullContent = await readFileWithSummaryAndMetrics('/path/to/file.ts', { 
  full: true 
});

// Just get content without metrics
const content = await readFileWithSummary('/path/to/file.ts');
```

### Using kaseki-summarizer CLI

```bash
# Generate summarization metrics for a repository
node dist/kaseki-summarizer.js \
  --repo-dir /path/to/repo \
  --results-dir /tmp/metrics \
  --verbose

# With file limit (for testing)
node dist/kaseki-summarizer.js \
  --repo-dir . \
  --results-dir ./metrics \
  --max-files 5 \
  --verbose
```

## Core Modules

### 1. TreeSitterSummarizer

Extracts code structure from TypeScript, JavaScript, and Go files.

```typescript
import { TreeSitterSummarizer } from './summarization/tree-sitter-summarizer';

const summarizer = new TreeSitterSummarizer('typescript');
const summary = summarizer.summarize(fileContent);

console.log('Classes:', summary.classes.map(c => c.name));
console.log('Functions:', summary.functions.map(f => f.name));
console.log('Imports:', summary.imports);
console.log('Exports:', summary.exports);
```

**Supported Languages**: `typescript` | `javascript` | `go`

### 2. SummaryCache

Caches summaries with file hash validation to prevent stale data.

```typescript
import { SummaryCache } from './summarization/summary-cache';

const cache = new SummaryCache('./.cache');

// Store summary
cache.set('/path/to/file.ts', jsonString, 'typescript');

// Retrieve with automatic validation
const cached = cache.get('/path/to/file.ts');
if (cached) {
  console.log('Cache hit:', cached.content);
} else {
  console.log('Cache miss or invalidated');
}

// View stats
const stats = cache.getStats();
console.log('Cache entries:', stats.entriesCount);
```

### 3. ReadStrategy

Determines whether summarization is beneficial for a file.

```typescript
import { getReadStrategy } from './summarization/read-strategy';
import { getConfig } from './summarization/summarizer-config';

const config = getConfig();
const strategy = getReadStrategy({
  filePath: '/path/to/file.ts',
  sizeBytes: 50000,
  language: 'typescript',
  config,
});

console.log(`Strategy: ${strategy.strategy}`);  // 'full' or 'summary'
console.log(`Reason: ${strategy.reason}`);
```

**Decision Rules** (in order):
1. Draft mode → full read
2. Parse error → full read
3. File < 2KB → full read
4. Unsupported language → full read
5. File > 1MB → full read
6. Default → summary

### 4. ReadWrapper

Main orchestration layer combining all components.

```typescript
import { 
  readFileWithSummary,
  readFileWithSummaryAndMetrics 
} from './summarization/read-wrapper';

// Simple content read
const content = await readFileWithSummary('/path/to/file.ts');

// Content with full metrics
const result = await readFileWithSummaryAndMetrics('/path/to/file.ts');
if (result) {
  const { content, metrics } = result;
  
  console.log('Metrics:', {
    strategy: metrics.strategy,
    language: metrics.language,
    fullSizeBytes: metrics.fullSizeBytes,
    returnedSizeBytes: metrics.returnedSizeBytes,
    compressionRatio: metrics.compressionRatio,
    parseTimeMs: metrics.parseTimeMs,
    cacheHit: metrics.cacheHit,
    decisionPath: metrics.decisionPath,
    estimatedTokensSaved: metrics.estimatedTokensSaved,
  });
}
```

### 5. SummarizerConfig

Configuration management with environment variable overrides.

```typescript
import { getConfig } from './summarization/summarizer-config';

const config = getConfig();

console.log('Min size for summarization:', config.minSizeBytes);
console.log('Max size for summarization:', config.maxSizeBytes);
console.log('Parse timeout:', config.parseTimeoutMs);
console.log('Cache enabled:', config.enableCache);
console.log('Supported languages:', config.supportedLanguages);
```

**Environment Variables**:
```bash
KASEKI_SUMMARY_MIN_BYTES=2048
KASEKI_SUMMARY_MAX_BYTES=1048576
KASEKI_SUMMARY_PARSE_TIMEOUT=100
KASEKI_SUMMARY_CACHE=true
KASEKI_SUMMARY_CACHE_DIR=.kaseki-summary-cache
KASEKI_SUMMARY_LLM_FALLBACK=true
KASEKI_SUMMARY_LLM_TIMEOUT=5000
```

## Common Use Cases

### Use Case 1: Pre-process a Codebase

```bash
# Generate metrics for all files
node dist/kaseki-summarizer.js \
  --repo-dir /path/to/repo \
  --results-dir ./results \
  --verbose
```

**Output files**:
- `summarization-metadata.json` - Full statistics
- `summarization-annotation.txt` - TASK_PROMPT annotation
- `summarization-cache-stats.json` - Cache performance

### Use Case 2: Selectively Summarize Large Files

```typescript
const result = await readFileWithSummaryAndMetrics(filePath);

if (result?.metrics && result.metrics.estimatedTokensSaved > 100) {
  console.log(`Saving ~${result.metrics.estimatedTokensSaved} tokens`);
  sendToLLM(result.content);  // Use summary
} else {
  sendToLLM(result.content);  // Use full content
}
```

### Use Case 3: Cache Warm-up

```typescript
// Process directory to warm cache
const files = fs.readdirSync('./src', { recursive: true });

for (const file of files) {
  if (file.match(/\.(ts|js|go)$/)) {
    await readFileWithSummary(`./src/${file}`);
  }
}

// Subsequent runs will hit cache
```

### Use Case 4: Monitor Summarization Effectiveness

```typescript
let totalTokens = 0;
let savedTokens = 0;

for (const file of filesToProcess) {
  const result = await readFileWithSummaryAndMetrics(file);
  if (result?.metrics) {
    totalTokens += result.metrics.estimatedTokensFull;
    savedTokens += result.metrics.estimatedTokensSaved;
  }
}

console.log(`Total tokens: ${totalTokens}`);
console.log(`Tokens saved: ${savedTokens}`);
console.log(`Reduction: ${((savedTokens / totalTokens) * 100).toFixed(1)}%`);
```

## Testing

### Run All Tests

```bash
npm run test:unit -- tests/summarization/ --no-coverage
```

### Run Specific Test Suite

```bash
npm run test:unit -- tests/summarization/tree-sitter-summarizer.test.ts
npm run test:unit -- tests/summarization/summary-cache.test.ts
npm run test:unit -- tests/summarization/read-strategy.test.ts
npm run test:unit -- tests/summarization/read-wrapper.test.ts
npm run test:unit -- tests/summarization/integration.test.ts
```

### Run Integration Test

```bash
npm run test:feature3
```

## Performance Tips

### 1. Tune Size Thresholds

```bash
# More aggressive summarization (lower min threshold)
export KASEKI_SUMMARY_MIN_BYTES=512

# Be more conservative (higher min threshold)
export KASEKI_SUMMARY_MIN_BYTES=8192
```

### 2. Enable Caching for Repeated Runs

```bash
export KASEKI_SUMMARY_CACHE=true
export KASEKI_SUMMARY_CACHE_DIR=/persistent/cache
```

### 3. Adjust Parse Timeout

```bash
# Faster timeout, more full reads
export KASEKI_SUMMARY_PARSE_TIMEOUT=50

# Slower timeout, more summaries
export KASEKI_SUMMARY_PARSE_TIMEOUT=200
```

### 4. Limit File Processing

```bash
# For testing, process only first N files
node dist/kaseki-summarizer.js \
  --repo-dir . \
  --results-dir ./results \
  --max-files 10
```

## Troubleshooting

### Issue: "Cannot find module 'tree-sitter'"

**Solution**: Install dependencies
```bash
npm install
```

### Issue: Summarization always returns full read

**Diagnosis**: Check file size vs thresholds
```bash
export KASEKI_SUMMARY_MIN_BYTES=512  # Lower threshold
export KASEKI_SUMMARY_MAX_BYTES=5000000  # Raise limit
```

### Issue: Parse timeout occurring frequently

**Solution**: Increase timeout
```bash
export KASEKI_SUMMARY_PARSE_TIMEOUT=500  # 500ms
```

### Issue: Cache not working

**Solution**: Verify cache directory
```bash
export KASEKI_SUMMARY_CACHE_DIR=./my-cache
export KASEKI_SUMMARY_CACHE=true
ls -la ./my-cache  # Check directory exists
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│  ReadFileWithSummaryAndMetrics (Public API)         │
└────────────────┬────────────────────────────────────┘
                 │
        ┌────────▼────────┐
        │  ReadWrapper    │ (Orchestration)
        └────────┬────────┘
         ┌───────┴──────┬─────────────┐
         │              │             │
    ┌────▼─────┐  ┌────▼─────┐  ┌───▼──────────┐
    │  Cache   │  │ Strategy │  │ TreeSitter   │
    │  Check   │  │ Decision │  │ Summarizer   │
    └────┬─────┘  └────┬─────┘  └───┬──────────┘
         │              │            │
         │              ▼            │
         │         Decision Tree     │
         │         (6 Rules)         │
         │              │            │
         └──────┬───────┘            │
                │                    │
         ┌──────▼────────────────────▼──────┐
         │    Content or Summary             │
         │    + Metrics + Cache Stats        │
         └─────────────────────────────────┘
```

## API Reference

### readFileWithSummary(filePath, options?)

```typescript
async function readFileWithSummary(
  filePath: string, 
  options?: ReadOptions
): Promise<string | null>
```

**Parameters**:
- `filePath` - Path to file to read
- `options?.full` - Force full read (boolean)
- `options?.isDraft` - In editing phase (boolean)
- `options?.timeoutMs` - Parse timeout (number)

**Returns**: File content as string, or null on error

### readFileWithSummaryAndMetrics(filePath, options?)

```typescript
async function readFileWithSummaryAndMetrics(
  filePath: string,
  options?: ReadOptions
): Promise<ReadResult | null>
```

**Returns**: Object with `content: string` and `metrics: ReadMetrics`

**Metrics fields**:
- `strategy` - 'full' or 'summary'
- `strategyReason` - Why this strategy was chosen
- `language` - Detected language
- `fullSizeBytes` - Original file size
- `returnedSizeBytes` - Size of returned content
- `compressionRatio` - Returned / Full ratio
- `parseTimeMs` - Time to parse
- `cacheHit` - Whether cache was hit
- `decisionPath` - How decision was made
- `estimatedTokensSaved` - Approximate tokens saved

## License

Feature 3 is part of kaseki-agent and follows the same license.

## Support

For issues or questions, refer to:
- [Feature 3 Integration Guide](docs/FEATURE3_INTEGRATION_GUIDE.md)
- [Feature 3 Completion Summary](docs/FEATURE3_COMPLETION_SUMMARY.md)
- [Test Examples](tests/summarization/)
