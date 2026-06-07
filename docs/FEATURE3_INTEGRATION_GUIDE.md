# Feature 3 Integration Guide: Summarization in kaseki-agent

## Overview

Feature 3 provides intelligent code summarization for kaseki-agent to reduce context overhead when invoking the Pi coding agent. This guide explains the integration and how to use it.

## Architecture

### Components

1. **TreeSitterSummarizer** (`src/summarization/tree-sitter-summarizer.ts`)
   - Core AST parsing using tree-sitter
   - Extracts code structure without implementations
   - Supports TypeScript, JavaScript, Go
   - Returns structured CodeSummary with metadata

2. **SummaryCache** (`src/summarization/summary-cache.ts`)
   - In-memory cache with file hash validation
   - Prevents stale summaries with automatic invalidation
   - Tracks cache statistics for metrics

3. **ReadStrategy** (`src/summarization/read-strategy.ts`)
   - Smart thresholding logic (6 decision rules)
   - Determines when summarization is beneficial vs full read
   - Configurable via environment variables

4. **ReadWrapper** (`src/summarization/read-wrapper.ts`)
   - Main orchestration layer
   - Combines all components into unified API
   - Returns content with optional metrics
   - Graceful error handling and degradation

5. **KasekiSummarizer** (`src/kaseki-summarizer.ts`)
   - CLI utility for preprocessing files
   - Generates summarization metrics and annotations
   - Integrates with kaseki-agent.sh

## Usage

### Running Directly (Node.js)

```typescript
import { readFileWithSummaryAndMetrics } from './summarization/read-wrapper';

const result = await readFileWithSummaryAndMetrics('/path/to/file.ts');
if (result?.metrics) {
  console.log(`Strategy: ${result.metrics.strategy}`);
  console.log(`Tokens saved: ${result.metrics.estimatedTokensSaved}`);
}
```

### Running via CLI

```bash
# Test Feature 3 end-to-end
npm run test:feature3

# Run summarizer on repository
node dist/kaseki-summarizer.js \
  --repo-dir . \
  --results-dir /tmp/results \
  --verbose \
  --max-files 10
```

### Integration in kaseki-agent.sh

The summarizer automatically runs before the Pi coding agent:

```bash
# In kaseki-agent.sh build_agent_prompt()
if command -v kaseki-summarizer >/dev/null 2>&1; then
  kaseki-summarizer --repo-dir "$WORKSPACE_DIR" \
    --results-dir "$KASEKI_RESULTS_DIR" --verbose
fi
```

The generated annotation is automatically included in TASK_PROMPT.

## Configuration

### Environment Variables

```bash
# Thresholds for summarization decisions (bytes)
KASEKI_SUMMARY_MIN_BYTES=2048          # Files smaller than this always full read
KASEKI_SUMMARY_MAX_BYTES=1048576       # Files larger than this always full read

# Performance tuning (milliseconds)
KASEKI_SUMMARY_PARSE_TIMEOUT=100       # Parsing timeout before fallback

# Caching
KASEKI_SUMMARY_CACHE=true              # Enable caching
KASEKI_SUMMARY_CACHE_DIR=.kaseki-summary-cache  # Cache directory

# LLM fallback (future)
KASEKI_SUMMARY_LLM_FALLBACK=true       # Enable Claude fallback
KASEKI_SUMMARY_LLM_TIMEOUT=5000        # LLM timeout (ms)
```

### Default Thresholds

- **Min size**: 2KB (2048 bytes)
- **Max size**: 1MB (1048576 bytes)
- **Parse timeout**: 100ms
- **Supported languages**: TypeScript, JavaScript, Go

Files outside the size range or in unsupported languages fall back to full read.

## Output

### Summarization Metrics

```json
{
  "files_processed": 3,
  "total_bytes_full": 16979,
  "total_bytes_returned": 16979,
  "total_compression_ratio": 1,
  "estimated_tokens_full": 4853,
  "estimated_tokens_returned": 4853,
  "estimated_tokens_saved": 0,
  "avg_parse_time_ms": 0.42,
  "cache_hits": 0,
  "files_by_strategy": { "full": 3 },
  "files_by_language": { "typescript": 1, "unknown": 2 },
  "timestamp": "2026-06-07T18:04:17.912Z",
  "duration_ms": 4
}
```

### TASK_PROMPT Annotation

```
Code Summary Metadata:
- Files analyzed: 3
- Full context: 4853 tokens
- Summarized context: 4853 tokens
- Tokens saved: ~0 (0.0% reduction)
- Processing time: 4ms
- Read strategies: [full:3]
```

## Test Coverage

### Unit Tests (58 total)

- **TreeSitterSummarizer** (18 tests)
  - Code structure extraction
  - Error handling
  - Language support
  - Performance metrics

- **SummaryCache** (7 tests)
  - Cache storage and retrieval
  - File hash validation
  - Cache invalidation

- **ReadStrategy** (8 tests)
  - Decision logic
  - Size thresholds
  - Language support
  - Token savings estimation

- **ReadWrapper** (17 tests)
  - Orchestration and integration
  - Metrics reporting
  - Graceful degradation

- **Integration** (8 tests)
  - Real-world workflows
  - Mixed file types
  - Error recovery
  - Performance characteristics

### Integration Test

```bash
npm run test:feature3
```

Tests end-to-end summarization with realistic files and scenarios.

## Performance

### Benchmarks

- **Small file (< 2KB)**: Full read (no summarization overhead)
- **Medium file (2-100KB)**: 30-50ms parse time, 20-30% compression
- **Large file (100KB+)**: Up to 1MB supported, graceful timeout handling

### Optimization Tips

1. **Increase parse timeout for larger files**

   ```bash
   export KASEKI_SUMMARY_PARSE_TIMEOUT=500
   ```

2. **Adjust size thresholds based on codebase**

   ```bash
   export KASEKI_SUMMARY_MIN_BYTES=1024      # More aggressive
   export KASEKI_SUMMARY_MAX_BYTES=500000    # Smaller max
   ```

3. **Enable caching for repeated runs**

   ```bash
   export KASEKI_SUMMARY_CACHE=true
   ```

## Troubleshooting

### Issue: "kaseki-summarizer not found"

**Solution**: Ensure dist/ is built and executable

```bash
npm run build
chmod +x dist/kaseki-summarizer.js
```

### Issue: Summarization not appearing in TASK_PROMPT

**Solution**: Check that summarization annotation file was generated

```bash
cat ${KASEKI_RESULTS_DIR}/summarization-annotation.txt
cat ${KASEKI_RESULTS_DIR}/summarizer-stderr.log  # Check for errors
```

### Issue: All files returning full read (no compression)

**Solution**: Files are likely below the min size threshold

```bash
# Lower the threshold to summarize smaller files
export KASEKI_SUMMARY_MIN_BYTES=512
```

## Future Enhancements

1. **LLM Fallback**: Use Claude for unsupported languages
2. **Cross-run Caching**: Persist cache across runs
3. **Granular Summaries**: Summarize individual functions/classes
4. **Chunk-based Parsing**: Handle files too large for tree-sitter
5. **Metrics Dashboard**: Visualize summarization ROI over time

## References

- [Feature 3 Design](docs/FEATURE3_SUMMARIZATION.md)
- [tree-sitter Documentation](https://tree-sitter.github.io/)
- [Code Summary API](src/summarization/README.md)
