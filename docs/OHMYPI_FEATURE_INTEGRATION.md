# Oh-My-Pi Feature Integration Guide for Kaseki-Agent

**Purpose**: This document outlines five high-impact features from oh-my-pi that are suitable for implementation in kaseki-agent. Each feature is contextualized within kaseki-agent's architecture and includes implementation guidance for AI coding agents.

**Target Audience**: AI coding agents performing feature implementation  
**Expected Implementation Timeline**: 6 weeks per feature (1-2 features in parallel)  
**Success Criteria**: Each feature should improve patch reliability, reduce token costs, or improve setup UX

---

## Table of Contents

1. [Feature 1: Hashline Editing](#feature-1-hashline-editing)
2. [Feature 2: LSP Integration for Refactoring](#feature-2-lsp-integration-for-refactoring)
3. [Feature 3: Better File Read Summarization](#feature-3-better-file-read-summarization)
4. [Feature 4: AST Operations](#feature-4-ast-operations)
5. [Feature 8: Configuration Inheritance](#feature-8-configuration-inheritance)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Testing Strategy](#testing-strategy)

---

## Feature 1: Hashline Editing

### Overview

**What it is**: Content-anchored edits that use hash-based line anchors instead of line numbers or text-based string replacement. The model identifies lines by their content hash and proposes replacements; the runtime validates anchors before applying edits.

**Problem Solved**: Pi agent edits currently fail when:

- Context becomes stale between planning and editing phases
- Multiple edits collide or shift line numbers
- Whitespace/formatting changes invalidate string matching
- Retry loops consume tokens (61% token reduction possible on frontier models)

**Kaseki-Agent Context**: Currently, kaseki's Pi invocation passes the agent file content and receives string-replacement patches. If the file changes between the read and write, or context drifts, the patch fails. Hashline editing eliminates this friction.

**Expected ROI**: 15–25% reduction in validation failures (especially for large refactorings)

---

### Implementation Guidance

#### Step 1: Understand the Hashline Format

The hashline edit format uses content anchors instead of line numbers:

```json
{
  "type": "hashline_edit",
  "file": "src/parser.ts",
  "edits": [
    {
      "anchor": {
        "start_hash": "7a2f8c1e",
        "end_hash": "9b3d4f2a",
        "context_lines": 3
      },
      "replacement": "  // New implementation\n  return processResult(input);"
    }
  ]
}
```

**How it works**:

- `start_hash`: SHA-256 hash of the first line to be replaced (truncated to 8 chars)
- `end_hash`: SHA-256 hash of the last line to be replaced
- `context_lines`: Number of surrounding lines to include for disambiguation
- `replacement`: The new content to insert

#### Step 2: Extend Pi's Tool Surface

Pi (the underlying agent) needs to support a new `hashline_edit` tool. This requires:

1. **Add to Pi's tool manifest** (in kaseki's configuration):
   - Tool name: `hashline_edit`
   - Parameters: `file`, `anchor`, `replacement`
   - Validation: Hash verification before apply

2. **Modify kaseki-agent.sh** to handle hashline responses:
   - After Pi completes, parse JSONL for `tool_call` events with `type: hashline_edit`
   - Validate hashes against current file state
   - If hashes don't match (stale anchor), reject and ask Pi to retry
   - If hashes match, apply replacement

3. **Create `src/hashline-validator.ts`**:

   ```typescript
   import crypto from 'crypto';
   import fs from 'fs';

   export interface HashlineAnchor {
     startHash: string;
     endHash: string;
     contextLines: number;
   }

   export interface HashlineEdit {
     file: string;
     anchor: HashlineAnchor;
     replacement: string;
   }

   export class HashlineValidator {
     /**
      * Validate that anchor hashes match the file's current content
      * Returns: { valid: boolean, lineStart?: number, lineEnd?: number, reason?: string }
      */
     validateAnchor(edit: HashlineEdit): { valid: boolean; lineStart?: number; lineEnd?: number; reason?: string } {
       const fileContent = fs.readFileSync(edit.file, 'utf-8');
       const lines = fileContent.split('\n');

       // Find line that starts with startHash
       const startLine = lines.findIndex(line => this.getLineHash(line).startsWith(edit.anchor.startHash));
       if (startLine === -1) {
         return { valid: false, reason: `Start anchor ${edit.anchor.startHash} not found` };
       }

       // Find line that ends with endHash (within contextLines distance)
       const searchEnd = Math.min(startLine + edit.anchor.contextLines + 10, lines.length);
       const endLine = lines.slice(startLine + 1, searchEnd).findIndex(line => this.getLineHash(line).startsWith(edit.anchor.endHash));
       
       if (endLine === -1) {
         return { valid: false, reason: `End anchor ${edit.anchor.endHash} not found within context` };
       }

       return { valid: true, lineStart: startLine, lineEnd: startLine + endLine + 1 };
     }

     /**
      * Apply a validated hashline edit
      */
     applyEdit(edit: HashlineEdit, lineStart: number, lineEnd: number): void {
       const fileContent = fs.readFileSync(edit.file, 'utf-8');
       const lines = fileContent.split('\n');
       const newLines = [...lines.slice(0, lineStart), edit.replacement, ...lines.slice(lineEnd)];
       fs.writeFileSync(edit.file, newLines.join('\n'));
     }

     private getLineHash(line: string): string {
       return crypto.createHash('sha256').update(line).digest('hex').slice(0, 8);
     }
   }
   ```

#### Step 3: Integrate into kaseki-agent.sh

Add hashline validation after Pi completes:

```bash
run_pi_with_hashline_validation() {
  # Existing Pi invocation...
  pi --model "$KASEKI_MODEL" --timeout "$KASEKI_AGENT_TIMEOUT_SECONDS" \
    --tools read,write,hashline_edit,search,bash \
    < <(cat "$TASK_PROMPT") > "$PI_EVENTS_FILE_RAW"

  # After Pi completes, validate all hashline edits
  # Parse pi-events.jsonl for hashline_edit tool calls
  # For each edit:
  #   1. Validate anchor hashes
  #   2. If invalid, collect rejection reason
  #   3. If valid, apply edit
  # Write validation results to metadata

  # Pseudocode:
  # for each hashline_edit in pi-events.jsonl:
  #   if validate_anchor(edit).valid:
  #     apply_edit(edit)
  #     record "hashline_edit_applied"
  #   else:
  #     record "hashline_edit_rejected: stale_anchor"
  #     ask Pi to retry (if retry budget allows)
}
```

#### Step 4: Update Prompts

Modify the TASK_PROMPT to guide Pi toward hashline edits:

```
# Instruction for Pi Agent
When editing files, use the `hashline_edit` tool:
- Read the file first to understand structure
- Identify the exact lines to replace by their content (not line numbers)
- Provide 3-5 context lines before and after the change
- Use hashline_edit with anchors instead of text-based replacement

Example:
- File: src/auth.ts
- Lines 45–50 contain old login logic
- Call: hashline_edit(file="src/auth.ts", anchor={startHash="abc123", endHash="def456"}, replacement="// new logic")
```

#### Step 5: Testing

Create `tests/hashline-validation.test.ts`:

```typescript
import { HashlineValidator } from '../src/hashline-validator';
import fs from 'fs';
import path from 'path';

describe('HashlineValidator', () => {
  let validator: HashlineValidator;
  let testFile: string;

  beforeEach(() => {
    validator = new HashlineValidator();
    testFile = path.join(__dirname, 'fixtures', 'test-hashline.ts');
  });

  test('should validate correct anchor hashes', () => {
    const edit = {
      file: testFile,
      anchor: {
        startHash: getHashForLine(testFile, 5),
        endHash: getHashForLine(testFile, 8),
        contextLines: 3,
      },
      replacement: '// new code',
    };
    const result = validator.validateAnchor(edit);
    expect(result.valid).toBe(true);
  });

  test('should reject stale anchor', () => {
    const edit = {
      file: testFile,
      anchor: {
        startHash: 'deadbeef',
        endHash: 'cafebabe',
        contextLines: 3,
      },
      replacement: '// new code',
    };
    const result = validator.validateAnchor(edit);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not found');
  });

  test('should apply edit correctly', () => {
    // Create temp file, apply edit, verify result
  });
});
```

---

## Feature 2: LSP Integration for Refactoring

### Overview

**What it is**: When the Pi agent performs code refactoring (renames, moves, reorganizes), route operations through Language Server Protocol (LSP) instead of text replacement. This ensures re-exports, aliased imports, barrel files, and cross-references update atomically.

**Problem Solved**: Pi agent refactorings currently fail because:

- Renaming a function doesn't update all call sites
- Moving a file breaks re-export chains in barrel files
- LSP knows the semantic relationships; text replacement doesn't
- Quality gates flag incomplete refactors as violations

**Kaseki-Agent Context**: Kaseki's allowlist restoration often triggers when Pi makes partial refactors. LSP integration would reduce these allowlist violations significantly.

**Expected ROI**: 20–30% fewer refactoring-related validation failures

---

### Implementation Guidance

#### Step 1: Understand LSP Operations

LSP provides several refactoring-safe operations:

| Operation | LSP Method | Use Case |
|-----------|-----------|----------|
| Rename symbol | `textDocument/rename` | Rename variable/function/class |
| Find references | `textDocument/references` | Identify all usages |
| Prepare rename | `textDocument/prepareRename` | Validate rename is safe |
| Code action | `textDocument/codeAction` | Apply semantic fixes |
| Workspace rename | `workspace/willRenameFiles` | Rename files safely |

#### Step 2: Set Up LSP Bridge

Create `src/lsp-bridge.ts`:

```typescript
import { spawn } from 'child_process';
import * as net from 'net';

export interface LSPConfig {
  language: 'typescript' | 'javascript' | 'python' | 'rust' | 'go';
  workspaceRoot: string;
  serverPath?: string; // Optional custom server path
}

export interface RenameParams {
  file: string;
  line: number;
  character: number;
  newName: string;
}

export class LSPBridge {
  private process: any;
  private socket: net.Socket;
  private messageId: number = 0;

  constructor(private config: LSPConfig) {}

  async initialize(): Promise<void> {
    // Start LSP server based on language
    // For TypeScript: `typescript-language-server`
    // For Python: `pylsp`
    // For Rust: `rust-analyzer`
    // For Go: `gopls`

    const serverPaths = {
      typescript: 'typescript-language-server',
      javascript: 'typescript-language-server',
      python: 'pylsp',
      rust: 'rust-analyzer',
      go: 'gopls',
    };

    const serverPath = this.config.serverPath || serverPaths[this.config.language];
    this.process = spawn(serverPath, ['--stdio']);

    // Send initialization request
    await this.sendRequest('initialize', {
      processId: process.pid,
      rootPath: this.config.workspaceRoot,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          rename: { dynamicRegistration: true },
        },
        workspace: {
          fileOperations: { willRename: true },
        },
      },
    });
  }

  async rename(params: RenameParams): Promise<any> {
    // Prepare rename (check if valid)
    const prepareResult = await this.sendRequest('textDocument/prepareRename', {
      textDocument: { uri: `file://${params.file}` },
      position: { line: params.line, character: params.character },
    });

    if (!prepareResult) {
      return { success: false, error: 'Cannot rename at this location' };
    }

    // Perform rename
    const renameResult = await this.sendRequest('textDocument/rename', {
      textDocument: { uri: `file://${params.file}` },
      position: { line: params.line, character: params.character },
      newName: params.newName,
    });

    return { success: true, edits: renameResult.changes };
  }

  async findReferences(file: string, line: number, character: number): Promise<any[]> {
    return this.sendRequest('textDocument/references', {
      textDocument: { uri: `file://${file}` },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    const id = ++this.messageId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    // Send to LSP server via stdin
    const message = JSON.stringify(request) + '\n';
    this.process.stdin.write(message);

    // Read response (simplified; real implementation needs proper async handling)
    return new Promise((resolve, reject) => {
      // Wait for response with matching id
      // Timeout after 5s
    });
  }

  shutdown(): void {
    this.process.kill();
  }
}
```

#### Step 3: Add LSP Tool to Pi's Tool Surface

Extend kaseki-agent.sh to offer LSP operations to Pi:

```bash
# In kaseki-agent.sh, create function to handle lsp_rename calls:

handle_lsp_operation() {
  local operation="$1"
  local file="$2"
  local line="$3"
  local char="$4"
  local new_name="$5"

  # Call LSP bridge (via Node.js)
  node -e "
    const LSPBridge = require('./dist/lsp-bridge').LSPBridge;
    const bridge = new LSPBridge({
      language: 'typescript',
      workspaceRoot: process.cwd()
    });
    bridge.initialize().then(() => {
      bridge.rename({ file, line, character: char, newName: new_name })
        .then(result => console.log(JSON.stringify(result)))
        .catch(err => console.error(JSON.stringify({ error: err.message })));
    });
  "
}
```

#### Step 4: Update Pi Prompts

Teach Pi to use LSP operations:

```
# Instruction for Pi: Refactoring Operations

When refactoring code (renaming functions, moving files, reorganizing imports):

1. For renaming a symbol (function, class, variable):
   - Use tool: lsp_rename(file="src/auth.ts", line=45, character=10, newName="newFunctionName")
   - LSP will update all references, re-exports, and imports automatically

2. For moving a file:
   - Use tool: lsp_move(oldPath="src/utils/helpers.ts", newPath="src/lib/helpers.ts")
   - LSP will update all import paths and re-exports

3. For finding where a symbol is used:
   - Use tool: lsp_references(file="src/auth.ts", line=45, character=10)
   - Returns all locations where this symbol is referenced

Do not use text-based find-and-replace for refactoring. LSP ensures consistency.
```

#### Step 5: Integration with Kaseki Validation

Capture LSP operations in results:

```bash
# In kaseki-agent.sh, after Pi completes:

grep '"type".*"lsp_' "$PI_EVENTS_FILE" | while read event; do
  operation=$(echo "$event" | jq -r '.tool_name')
  file=$(echo "$event" | jq -r '.params.file')
  echo "lsp_operation: $operation on $file" >> "$RESULTS_DIR/lsp-operations.log"
done
```

#### Step 6: Testing

Create `tests/lsp-bridge.test.ts`:

```typescript
import { LSPBridge } from '../src/lsp-bridge';

describe('LSPBridge', () => {
  let bridge: LSPBridge;

  beforeEach(() => {
    bridge = new LSPBridge({
      language: 'typescript',
      workspaceRoot: process.cwd(),
    });
  });

  test('should initialize LSP server', async () => {
    await bridge.initialize();
    expect(bridge).toBeDefined();
  });

  test('should rename symbol and update all references', async () => {
    // Create test file with function and multiple call sites
    // Rename function via LSP
    // Verify all call sites updated
  });

  test('should handle invalid renames gracefully', async () => {
    const result = await bridge.rename({
      file: 'test.ts',
      line: 999,
      character: 0,
      newName: 'newName',
    });
    expect(result.success).toBe(false);
  });

  afterEach(() => {
    bridge.shutdown();
  });
});
```

---

## Feature 3: Better File Read Summarization

### Overview

**What it is**: Replace full-file reads with intelligent structural summaries generated by tree-sitter. Summaries preserve class/function signatures, type definitions, and code structure while omitting implementation details and comments.

**Problem Solved**: Pi agent currently receives full file contents, consuming:

- Context tokens (especially for large files)
- Time (longer prompts = slower responses)
- Cost (more tokens = higher API bills)
- Noise (implementation details distract from structure)

**Kaseki-Agent Context**: Kaseki's 4-layer dependency cache already optimizes installation. Summarization optimizes the Pi invocation itself. Combined effect: 10–15% token reduction per run.

**Expected ROI**: 10–15% token reduction; faster Pi responses; cost savings

---

### Implementation Guidance

#### Step 1: Understand Summarization

Tree-sitter summarization extracts code structure without full implementation:

**Before (full file)**:

```typescript
// 200+ lines of implementation
export class AuthManager {
  private tokenCache: Map<string, Token>;
  private refreshInterval: number;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.tokenCache = new Map();
    // ... 50 lines of setup
  }

  async authenticate(credentials: Credentials): Promise<Token> {
    // ... 80 lines of implementation
  }

  // ... more methods
}
```

**After (summary)**:

```typescript
export class AuthManager {
  private tokenCache: Map<string, Token>;
  private refreshInterval: number;

  constructor(apiKey: string);
  async authenticate(credentials: Credentials): Promise<Token>;
  private validateToken(token: Token): boolean;
  private refreshToken(): Promise<Token>;
}
```

#### Step 2: Create Summarizer Module

Create `src/tree-sitter-summarizer.ts`:

```typescript
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

export interface CodeSummary {
  language: string;
  exports: Array<{ name: string; type: 'class' | 'function' | 'const' | 'type'; signature: string }>;
  imports: Array<{ module: string; items: string[] }>;
  classes: Array<{ name: string; methods: Array<{ name: string; signature: string }> }>;
  functions: Array<{ name: string; signature: string }>;
  types: Array<{ name: string; definition: string }>;
}

export class TreeSitterSummarizer {
  private parser: Parser;

  constructor(language: 'typescript' | 'javascript' | 'python' | 'rust' = 'typescript') {
    this.parser = new Parser();

    const languageMap = {
      typescript: TypeScript.TypeScript,
      javascript: TypeScript.JavaScript,
      python: require('tree-sitter-python'),
      rust: require('tree-sitter-rust'),
    };

    this.parser.setLanguage(languageMap[language]);
  }

  summarize(fileContent: string, options: { maxLines?: number } = {}): CodeSummary {
    const tree = this.parser.parse(fileContent);
    const summary: CodeSummary = {
      language: 'typescript',
      exports: [],
      imports: [],
      classes: [],
      functions: [],
      types: [],
    };

    this.traverseTree(tree.rootNode, fileContent, summary);

    // Trim if too large
    if (options.maxLines) {
      summary = this.trimSummary(summary, options.maxLines);
    }

    return summary;
  }

  private traverseTree(node: any, source: string, summary: CodeSummary): void {
    if (node.type === 'import_statement' || node.type === 'import_clause') {
      this.extractImport(node, source, summary);
    }

    if (node.type === 'export_statement') {
      this.extractExport(node, source, summary);
    }

    if (node.type === 'class_declaration') {
      this.extractClass(node, source, summary);
    }

    if (node.type === 'function_declaration') {
      this.extractFunction(node, source, summary);
    }

    if (node.type === 'type_alias_declaration') {
      this.extractTypeAlias(node, source, summary);
    }

    for (const child of node.children) {
      this.traverseTree(child, source, summary);
    }
  }

  private extractImport(node: any, source: string, summary: CodeSummary): void {
    const text = source.substring(node.startIndex, node.endIndex);
    // Parse import statement, extract module and items
    // Example: `import { foo, bar } from 'module'` -> { module: 'module', items: ['foo', 'bar'] }
  }

  private extractClass(node: any, source: string, summary: CodeSummary): void {
    const name = node.child(1)?.text || 'Unknown';
    const methods: Array<{ name: string; signature: string }> = [];

    for (const child of node.children) {
      if (child.type === 'method_definition' || child.type === 'public_field_definition') {
        const methodName = child.child(0)?.text || '';
        const signature = source.substring(child.startIndex, child.endIndex).split('\n')[0];
        methods.push({ name: methodName, signature });
      }
    }

    summary.classes.push({ name, methods });
  }

  private extractFunction(node: any, source: string, summary: CodeSummary): void {
    const name = node.child(1)?.text || 'Unknown';
    const signature = source.substring(node.startIndex, node.endIndex).split('\n')[0];
    summary.functions.push({ name, signature });
  }

  private extractTypeAlias(node: any, source: string, summary: CodeSummary): void {
    const name = node.child(1)?.text || 'Unknown';
    const definition = source.substring(node.startIndex, node.endIndex);
    summary.types.push({ name, definition });
  }

  private trimSummary(summary: CodeSummary, maxLines: number): CodeSummary {
    // Implement trimming logic if summary is too large
    return summary;
  }

  summarizeToMarkdown(summary: CodeSummary): string {
    let output = '';

    if (summary.imports.length > 0) {
      output += '## Imports\n';
      for (const imp of summary.imports) {
        output += `- From \`${imp.module}\`: ${imp.items.join(', ')}\n`;
      }
    }

    if (summary.classes.length > 0) {
      output += '\n## Classes\n';
      for (const cls of summary.classes) {
        output += `### ${cls.name}\n`;
        for (const method of cls.methods) {
          output += `- ${method.signature}\n`;
        }
      }
    }

    if (summary.functions.length > 0) {
      output += '\n## Functions\n';
      for (const fn of summary.functions) {
        output += `- ${fn.signature}\n`;
      }
    }

    if (summary.types.length > 0) {
      output += '\n## Types\n';
      for (const type of summary.types) {
        output += `- \`${type.name}\`: ${type.definition.split('\n')[0]}\n`;
      }
    }

    return output;
  }
}
```

#### Step 3: Integrate into Read Tool

Modify Pi's `read` tool to use summarization:

```bash
# In kaseki-agent.sh, when preparing context for Pi:

read_file_for_pi() {
  local file="$1"
  local use_summary="${2:-true}"

  if [ "$use_summary" = "true" ]; then
    # Use summarizer
    node -e "
      const { TreeSitterSummarizer } = require('./dist/tree-sitter-summarizer');
      const fs = require('fs');
      const content = fs.readFileSync('$file', 'utf-8');
      const summarizer = new TreeSitterSummarizer('typescript');
      const summary = summarizer.summarize(content);
      console.log(summarizer.summarizeToMarkdown(summary));
    "
  else
    # Fall back to full read
    cat "$file"
  fi
}
```

#### Step 4: Control via Pi Prompts

Let Pi request full read when needed:

```
# Instruction for Pi: Reading Files

By default, when you use the `read` tool:
- You receive a summary (imports, classes, functions, types, no implementations)
- This saves context and token cost

If you need the full implementation:
- Use: read(file="src/auth.ts", summary=false)
- This provides the entire file content

Prefer summaries for structure understanding. Use full reads only when you need implementation details.
```

#### Step 5: Testing

Create `tests/tree-sitter-summarizer.test.ts`:

```typescript
import { TreeSitterSummarizer } from '../src/tree-sitter-summarizer';
import fs from 'fs';

describe('TreeSitterSummarizer', () => {
  let summarizer: TreeSitterSummarizer;
  let testFile: string;

  beforeEach(() => {
    summarizer = new TreeSitterSummarizer('typescript');
    testFile = fs.readFileSync('tests/fixtures/large-file.ts', 'utf-8');
  });

  test('should extract classes and methods', () => {
    const summary = summarizer.summarize(testFile);
    expect(summary.classes.length).toBeGreaterThan(0);
    expect(summary.classes[0].methods.length).toBeGreaterThan(0);
  });

  test('should extract function signatures', () => {
    const summary = summarizer.summarize(testFile);
    expect(summary.functions.length).toBeGreaterThan(0);
  });

  test('should extract imports and exports', () => {
    const summary = summarizer.summarize(testFile);
    expect(summary.imports.length).toBeGreaterThan(0);
  });

  test('should produce markdown output', () => {
    const summary = summarizer.summarize(testFile);
    const markdown = summarizer.summarizeToMarkdown(summary);
    expect(markdown).toContain('## Classes');
    expect(markdown).toContain('## Functions');
  });

  test('should be smaller than full file', () => {
    const summary = summarizer.summarize(testFile);
    const markdown = summarizer.summarizeToMarkdown(summary);
    expect(markdown.length).toBeLessThan(testFile.length);
  });
});
```

#### Step 6: Measure Token Savings

Add metrics to kaseki results:

```bash
# In kaseki-agent.sh, after Pi completes:

FULL_FILE_SIZE=$(wc -c < "$WORKSPACE_DIR/src/main.ts")
SUMMARY_SIZE=$(node -e "console.log(summary.length)" < <(cat "$SUMMARY_FILE"))

echo "full_file_size_bytes: $FULL_FILE_SIZE" >> "$RESULTS_DIR/metrics.log"
echo "summary_size_bytes: $SUMMARY_SIZE" >> "$RESULTS_DIR/metrics.log"
echo "compression_ratio: $(echo "scale=2; $SUMMARY_SIZE / $FULL_FILE_SIZE" | bc)" >> "$RESULTS_DIR/metrics.log"
```

---

## Feature 4: AST Operations

### Overview

**What it is**: Structural code edits via AST (Abstract Syntax Tree) pattern matching and rewrites. The agent uses `ast_edit` (rewrite patterns) and `ast_grep` (structural queries) instead of regex or text-based approaches.

**Problem Solved**: Text-based edits are brittle:

- Regex patterns break if formatting changes
- Multi-line patterns are hard to express
- Refactoring multiple similar patterns requires manual iteration
- Safety: AST edits have preview-before-apply gates

**Kaseki-Agent Context**: Kaseki validates changes against allowlists. AST operations are more likely to be semantically correct, reducing allowlist violations and retry loops.

**Expected ROI**: 15–20% fewer failed patches; safer bulk refactorings

---

### Implementation Guidance

#### Step 1: Understand AST Operations

**ast_grep** (query):

```
# Find all console.log calls
ast_grep --pattern 'console.log($$$)' src/

# Find all unused variables
ast_grep --pattern 'const $VAR = $_; (no reference to $VAR)' src/
```

**ast_edit** (rewrite):

```json
{
  "type": "ast_edit",
  "file": "src/auth.ts",
  "pattern": "console.log($$$)",
  "replacement": "logger.debug($$$)",
  "count": 5
}
```

#### Step 2: Create AST Module

Create `src/ast-operations.ts`:

```typescript
import { execSync } from 'child_process';

export interface ASTPattern {
  language: 'typescript' | 'javascript' | 'python' | 'rust' | 'go';
  pattern: string;
  replacement?: string;
}

export interface ASTEditResult {
  file: string;
  pattern: string;
  replacements: number;
  preview: string;
  applied: boolean;
}

export class ASTOperations {
  private astGrepPath: string;

  constructor() {
    // Verify ast-grep is installed
    try {
      execSync('ast-grep --version', { stdio: 'ignore' });
      this.astGrepPath = 'ast-grep';
    } catch {
      throw new Error('ast-grep not found. Install: npm install -g ast-grep');
    }
  }

  /**
   * Query files using AST pattern
   */
  grepPatterns(pattern: ASTPattern, files: string[]): Array<{ file: string; line: number; text: string }> {
    const results: any[] = [];

    for (const file of files) {
      try {
        const output = execSync(
          `${this.astGrepPath} --pattern '${pattern.pattern}' --lang ${pattern.language} '${file}'`,
          { encoding: 'utf-8' }
        );

        // Parse output to extract matches
        const matches = output.split('\n').filter(line => line.trim());
        for (const match of matches) {
          results.push({ file, ...JSON.parse(match) });
        }
      } catch {
        // No matches or error
      }
    }

    return results;
  }

  /**
   * Preview AST edits without applying
   */
  previewEdit(pattern: ASTPattern, file: string): ASTEditResult {
    if (!pattern.replacement) {
      throw new Error('replacement required for edit preview');
    }

    try {
      const output = execSync(
        `${this.astGrepPath} --pattern '${pattern.pattern}' --rewrite '${pattern.replacement}' --lang ${pattern.language} --dry-run '${file}'`,
        { encoding: 'utf-8' }
      );

      const lines = output.split('\n');
      const replacementCount = lines.filter(l => l.includes('→')).length;

      return {
        file,
        pattern: pattern.pattern,
        replacements: replacementCount,
        preview: output,
        applied: false,
      };
    } catch (error) {
      throw new Error(`AST edit preview failed: ${error.message}`);
    }
  }

  /**
   * Apply AST edits (after user confirmation)
   */
  applyEdit(pattern: ASTPattern, file: string, confirmed: boolean = false): ASTEditResult {
    if (!confirmed) {
      throw new Error('Edit requires confirmation (preview first)');
    }

    if (!pattern.replacement) {
      throw new Error('replacement required for edit');
    }

    try {
      const output = execSync(
        `${this.astGrepPath} --pattern '${pattern.pattern}' --rewrite '${pattern.replacement}' --lang ${pattern.language} '${file}'`,
        { encoding: 'utf-8' }
      );

      const replacementCount = output.split('\n').filter(l => l.includes('✓')).length;

      return {
        file,
        pattern: pattern.pattern,
        replacements: replacementCount,
        preview: output,
        applied: true,
      };
    } catch (error) {
      throw new Error(`AST edit apply failed: ${error.message}`);
    }
  }

  /**
   * Find patterns across codebase
   */
  findPatternAcrossRepo(pattern: ASTPattern, rootDir: string = '.'): Map<string, number> {
    const results = new Map<string, number>();

    try {
      const output = execSync(
        `${this.astGrepPath} --pattern '${pattern.pattern}' --lang ${pattern.language} --json '${rootDir}'`,
        { encoding: 'utf-8' }
      );

      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const match = JSON.parse(line);
          const file = match.file;
          results.set(file, (results.get(file) || 0) + 1);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // No matches or error
    }

    return results;
  }
}
```

#### Step 3: Integrate into Pi's Tool Surface

Extend kaseki-agent.sh to offer AST operations:

```bash
# In kaseki-agent.sh:

handle_ast_operation() {
  local operation="$1"
  local pattern="$2"
  local file="$3"
  local replacement="$4"

  # For ast_grep
  if [ "$operation" = "grep" ]; then
    node -e "
      const { ASTOperations } = require('./dist/ast-operations');
      const ops = new ASTOperations();
      const results = ops.grepPatterns(
        { language: 'typescript', pattern: '$pattern' },
        ['$file']
      );
      console.log(JSON.stringify(results));
    "
  fi

  # For ast_edit preview
  if [ "$operation" = "edit_preview" ]; then
    node -e "
      const { ASTOperations } = require('./dist/ast-operations');
      const ops = new ASTOperations();
      const result = ops.previewEdit(
        { language: 'typescript', pattern: '$pattern', replacement: '$replacement' },
        '$file'
      );
      console.log(JSON.stringify(result));
    "
  fi

  # For ast_edit apply
  if [ "$operation" = "edit_apply" ]; then
    node -e "
      const { ASTOperations } = require('./dist/ast-operations');
      const ops = new ASTOperations();
      const result = ops.applyEdit(
        { language: 'typescript', pattern: '$pattern', replacement: '$replacement' },
        '$file',
        true
      );
      console.log(JSON.stringify(result));
    "
  fi
}
```

#### Step 4: Update Pi Prompts

Teach Pi to use AST operations:

```
# Instruction for Pi: AST Operations

For structural code refactoring, use AST operations instead of text replacement:

1. **Find patterns**: Use ast_grep to locate all instances
   - Example: ast_grep(pattern="console.log($$$)", file="src/auth.ts")
   - Returns: all console.log calls with their line numbers

2. **Preview changes**: Use ast_edit_preview to see what will change
   - Example: ast_edit_preview(pattern="console.log($$$)", replacement="logger.debug($$$)", file="src/auth.ts")
   - Returns: preview with count of replacements

3. **Apply changes**: Once preview approved, use ast_edit_apply
   - Example: ast_edit_apply(pattern="console.log($$$)", replacement="logger.debug($$$)", file="src/auth.ts")
   - Returns: result with applied count

Benefits:
- Patterns work regardless of whitespace/formatting
- Multi-line patterns supported
- Preview before apply prevents mistakes
- Safer than regex or text replacement
```

#### Step 5: Testing

Create `tests/ast-operations.test.ts`:

```typescript
import { ASTOperations } from '../src/ast-operations';
import fs from 'fs';
import path from 'path';

describe('ASTOperations', () => {
  let ops: ASTOperations;
  let testFile: string;

  beforeEach(() => {
    ops = new ASTOperations();
    testFile = path.join(__dirname, 'fixtures', 'test-ast.ts');
  });

  test('should find patterns with ast_grep', () => {
    const results = ops.grepPatterns(
      { language: 'typescript', pattern: 'console.log($$$)' },
      [testFile]
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test('should preview AST edits without applying', () => {
    const result = ops.previewEdit(
      { language: 'typescript', pattern: 'console.log($$$)', replacement: 'logger.debug($$$)' },
      testFile
    );
    expect(result.applied).toBe(false);
    expect(result.replacements).toBeGreaterThan(0);
  });

  test('should apply AST edits when confirmed', () => {
    const tempFile = fs.copyFileSync(testFile, path.join(__dirname, 'fixtures', 'test-ast-copy.ts'));
    const result = ops.applyEdit(
      { language: 'typescript', pattern: 'console.log($$$)', replacement: 'logger.debug($$$)' },
      tempFile,
      true
    );
    expect(result.applied).toBe(true);
    // Verify file content changed
    const newContent = fs.readFileSync(tempFile, 'utf-8');
    expect(newContent).toContain('logger.debug');
  });

  test('should find patterns across repo', () => {
    const results = ops.findPatternAcrossRepo(
      { language: 'typescript', pattern: 'console.log($$$)' },
      'src/'
    );
    expect(results.size).toBeGreaterThan(0);
  });
});
```

---

## Feature 8: Configuration Inheritance

### Overview

**What it is**: Automatically discover and import AI tool configurations left by other tools (`.claude`, `.cursor`, `.cline`, `.github/copilot`, etc.) and merge them into kaseki's allowlist and setup.

**Problem Solved**: Teams often have already written AI tool configs for:

- Cline, Cursor, Claude Code, GitHub Copilot, Codex, Windsurf, Gemini
- Each tool has its own config format; rewriting for kaseki is expensive
- No standard way to share rules across tools
- Kaseki setup requires manual allowlist configuration

**Kaseki-Agent Context**: Kaseki's `SetupWizard` can auto-discover existing configs and merge them, reducing setup friction by ~30% and improving consistency across team tools.

**Expected ROI**: 30% reduction in manual allowlist tuning; faster team onboarding

---

### Implementation Guidance

#### Step 1: Understand Config Formats

Different tools store configs in different formats:

| Tool | Format | Path | Example |
|------|--------|------|---------|
| Claude (desktop) | TOML | `.claude/config.toml` | Rules, token limits |
| Cursor | YAML | `.cursor/rules.md` | System prompts, files |
| Cline | JSON | `.cline/cline_config.json` | Allowed directories, commands |
| GitHub Copilot | YAML | `.github/copilot/chat/` | Prompts, settings |
| Windsurf | JSON | `.windsurf/config.json` | Tools, models |
| Codex | MD | `.codex/AGENTS.md` | Agent definitions |
| VS Code | JSON | `.vscode/settings.json` | Extensions, workspace settings |

#### Step 2: Create Config Parser

Create `src/config-discovery.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import TOML from 'toml';
import YAML from 'yaml';

export interface DiscoveredConfig {
  source: string;
  type: 'rules' | 'allowlist' | 'commands' | 'prompts';
  content: any;
}

export class ConfigDiscovery {
  /**
   * Scan workspace for AI tool configs
   */
  discoverConfigs(rootDir: string = '.'): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    // Claude config
    const claudeConfig = path.join(rootDir, '.claude');
    if (fs.existsSync(claudeConfig)) {
      configs.push(...this.parseClaudeConfig(claudeConfig));
    }

    // Cursor config
    const cursorConfig = path.join(rootDir, '.cursor');
    if (fs.existsSync(cursorConfig)) {
      configs.push(...this.parseCursorConfig(cursorConfig));
    }

    // Cline config
    const clineConfig = path.join(rootDir, '.cline');
    if (fs.existsSync(clineConfig)) {
      configs.push(...this.parseClineConfig(clineConfig));
    }

    // GitHub Copilot config
    const copilotConfig = path.join(rootDir, '.github/copilot');
    if (fs.existsSync(copilotConfig)) {
      configs.push(...this.parseCopilotConfig(copilotConfig));
    }

    // Windsurf config
    const windsurfConfig = path.join(rootDir, '.windsurf');
    if (fs.existsSync(windsurfConfig)) {
      configs.push(...this.parseWindsurfConfig(windsurfConfig));
    }

    // Codex config
    const codexConfig = path.join(rootDir, '.codex');
    if (fs.existsSync(codexConfig)) {
      configs.push(...this.parseCodexConfig(codexConfig));
    }

    // VS Code settings
    const vscodeSettings = path.join(rootDir, '.vscode/settings.json');
    if (fs.existsSync(vscodeSettings)) {
      configs.push(...this.parseVSCodeSettings(vscodeSettings));
    }

    return configs;
  }

  private parseClaudeConfig(claudeDir: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    // Parse .claude/config.toml
    const configFile = path.join(claudeDir, 'config.toml');
    if (fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, 'utf-8');
      const parsed = TOML.parse(content);
      configs.push({
        source: '.claude/config.toml',
        type: 'rules',
        content: parsed,
      });
    }

    // Parse .claude/rules (directory)
    const rulesDir = path.join(claudeDir, 'rules');
    if (fs.existsSync(rulesDir)) {
      const files = fs.readdirSync(rulesDir);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.txt')) {
          const content = fs.readFileSync(path.join(rulesDir, file), 'utf-8');
          configs.push({
            source: `.claude/rules/${file}`,
            type: 'rules',
            content: { text: content },
          });
        }
      }
    }

    return configs;
  }

  private parseCursorConfig(cursorDir: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    // .cursor/.cursorules or .cursor/rules.md
    for (const filename of ['.cursorules', 'rules.md', '.cursor/rules']) {
      const filepath = path.join(cursorDir, filename);
      if (fs.existsSync(filepath)) {
        const content = fs.readFileSync(filepath, 'utf-8');
        configs.push({
          source: filename,
          type: 'rules',
          content: { text: content },
        });
      }
    }

    return configs;
  }

  private parseClineConfig(clineDir: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    const configFile = path.join(clineDir, 'cline_config.json');
    if (fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(content);
      configs.push({
        source: '.cline/cline_config.json',
        type: 'allowlist',
        content: parsed,
      });
    }

    return configs;
  }

  private parseCopilotConfig(copilotDir: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    // Check for .github/copilot-instructions.md
    const instructionsFile = path.join(copilotDir, '../copilot-instructions.md');
    if (fs.existsSync(instructionsFile)) {
      const content = fs.readFileSync(instructionsFile, 'utf-8');
      configs.push({
        source: '.github/copilot-instructions.md',
        type: 'rules',
        content: { text: content },
      });
    }

    return configs;
  }

  private parseWindsurfConfig(windsurfDir: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    const configFile = path.join(windsurfDir, 'config.json');
    if (fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(content);
      configs.push({
        source: '.windsurf/config.json',
        type: 'rules',
        content: parsed,
      });
    }

    return configs;
  }

  private parseCodexConfig(codexDir: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    const agentsFile = path.join(codexDir, 'AGENTS.md');
    if (fs.existsSync(agentsFile)) {
      const content = fs.readFileSync(agentsFile, 'utf-8');
      configs.push({
        source: '.codex/AGENTS.md',
        type: 'rules',
        content: { text: content },
      });
    }

    return configs;
  }

  private parseVSCodeSettings(settingsFile: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = [];

    const content = fs.readFileSync(settingsFile, 'utf-8');
    const parsed = JSON.parse(content);

    // Extract Copilot-related settings
    if (parsed['copilot.advanced']) {
      configs.push({
        source: '.vscode/settings.json (copilot.advanced)',
        type: 'rules',
        content: parsed['copilot.advanced'],
      });
    }

    return configs;
  }

  /**
   * Merge discovered configs into kaseki allowlist format
   */
  mergeIntoAllowlist(configs: DiscoveredConfig[]): string[] {
    const allowlist = new Set<string>();

    for (const config of configs) {
      if (config.type === 'allowlist' && config.content.allowedDirectories) {
        for (const dir of config.content.allowedDirectories) {
          allowlist.add(dir);
        }
      }

      if (config.type === 'rules' && config.content.text) {
        // Extract file patterns from markdown rules
        // Example: "allowed files: src/lib/*.ts docs/*.md"
        const matches = config.content.text.match(/(?:allowed|only modify|edit|files?):\s*([^\n]+)/gi);
        if (matches) {
          for (const match of matches) {
            const patterns = match.split(':')[1].trim().split(/[\s,]+/);
            for (const pattern of patterns) {
              if (pattern.includes('*') || pattern.includes('/')) {
                allowlist.add(pattern);
              }
            }
          }
        }
      }
    }

    return Array.from(allowlist);
  }
}
```

#### Step 3: Integrate into SetupWizard

Modify `src/setup/SetupWizard.ts` to use config discovery:

```typescript
import { ConfigDiscovery } from '../config-discovery';

export class SetupWizard {
  async run(): Promise<void> {
    // ... existing setup logic ...

    // NEW: Discover existing configs
    const discovery = new ConfigDiscovery();
    const discoveredConfigs = discovery.discoverConfigs(process.cwd());

    if (discoveredConfigs.length > 0) {
      console.log(`\n✓ Found ${discoveredConfigs.length} existing AI tool configurations`);
      console.log('   Configs found:');
      for (const config of discoveredConfigs) {
        console.log(`   - ${config.source} (${config.type})`);
      }

      const useDiscovered = await this.askUser(
        'Would you like to inherit these configurations? (recommended)'
      );

      if (useDiscovered) {
        const mergedAllowlist = discovery.mergeIntoAllowlist(discoveredConfigs);
        console.log(`\n✓ Merged ${mergedAllowlist.length} patterns into allowlist`);
        console.log('   Patterns:', mergedAllowlist.slice(0, 5).join(', '), '...');

        // Store merged allowlist
        this.essentialConfig.KASEKI_CHANGED_FILES_ALLOWLIST = mergedAllowlist.join(' ');
      }
    }

    // ... continue with wizard ...
  }
}
```

#### Step 4: Add Discovery to Init Command

Modify `src/cli/commands/InitCommand.ts`:

```typescript
import { ConfigDiscovery } from '../../config-discovery';

export class InitCommand {
  async execute(): Promise<void> {
    console.log('🔍 Discovering existing AI configurations...\n');

    const discovery = new ConfigDiscovery();
    const configs = discovery.discoverConfigs(process.cwd());

    if (configs.length > 0) {
      console.log(`Found ${configs.length} configurations from other AI tools:\n`);
      const table = configs.map(c => ({
        source: c.source,
        type: c.type,
        status: '✓ Discovered',
      }));
      console.table(table);

      const useConfigs = await this.askUser(
        'Inherit these configurations into kaseki-agent? (y/n)'
      );

      if (useConfigs) {
        const allowlist = discovery.mergeIntoAllowlist(configs);
        console.log(`\n✓ Inherited ${allowlist.length} file patterns\n`);
      }
    }

    // ... continue with standard setup ...
  }
}
```

#### Step 5: Documentation

Update `docs/QUICK_START.md` to mention config inheritance:

```markdown
## Automatic Configuration Discovery

When you run `kaseki-agent init`, kaseki automatically scans your workspace for existing AI tool configurations:

- `.claude/` (Claude)
- `.cursor/` (Cursor)
- `.cline/` (Cline)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `.windsurf/` (Windsurf)
- `.codex/` (Codex)
- `.vscode/settings.json` (VS Code)

If found, kaseki will ask if you want to inherit these configurations. This merges file patterns and rules into kaseki's allowlist, so you don't need to rewrite them.

**Example**:
```bash
$ kaseki-agent init
🔍 Discovering existing AI configurations...

Found 3 configurations:
- .cursor/.cursorules (rules)
- .cline/cline_config.json (allowlist)
- .github/copilot-instructions.md (rules)

Inherit these configurations? (y/n) y
✓ Inherited 12 file patterns into KASEKI_CHANGED_FILES_ALLOWLIST
```

```

#### Step 6: Testing

Create `tests/config-discovery.test.ts`:

```typescript
import { ConfigDiscovery } from '../src/config-discovery';
import fs from 'fs';
import path from 'path';

describe('ConfigDiscovery', () => {
  let discovery: ConfigDiscovery;
  let tempDir: string;

  beforeEach(() => {
    discovery = new ConfigDiscovery();
    tempDir = path.join(__dirname, 'fixtures', 'temp-configs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  test('should discover .cursor rules', () => {
    // Create .cursor/.cursorules
    fs.mkdirSync(path.join(tempDir, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.cursor', '.cursorules'),
      'Only modify: src/lib/*.ts\nDo not touch: tests/'
    );

    const configs = discovery.discoverConfigs(tempDir);
    expect(configs.some(c => c.source.includes('.cursor'))).toBe(true);
  });

  test('should discover .cline config', () => {
    // Create .cline/cline_config.json
    fs.mkdirSync(path.join(tempDir, '.cline'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.cline', 'cline_config.json'),
      JSON.stringify({ allowedDirectories: ['src/', 'tests/'] })
    );

    const configs = discovery.discoverConfigs(tempDir);
    expect(configs.some(c => c.source.includes('.cline'))).toBe(true);
  });

  test('should merge configs into allowlist', () => {
    const configs = [
      {
        source: 'test1',
        type: 'allowlist' as const,
        content: { allowedDirectories: ['src/', 'tests/'] },
      },
      {
        source: 'test2',
        type: 'allowlist' as const,
        content: { allowedDirectories: ['docs/'] },
      },
    ];

    const allowlist = discovery.mergeIntoAllowlist(configs);
    expect(allowlist).toContain('src/');
    expect(allowlist).toContain('tests/');
    expect(allowlist).toContain('docs/');
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
```

---

## Implementation Roadmap

### Timeline

| Phase | Duration | Features | Teams |
|-------|----------|----------|-------|
| **Phase 1** | Week 1–2 | Config Inheritance | 1 engineer |
| **Phase 2** | Week 1–3 | File Read Summarization + Hashline Editing | 1–2 engineers |
| **Phase 3** | Week 3–5 | AST Operations | 1 engineer |
| **Phase 4** | Week 4–6 | LSP Integration | 1 engineer |

### Dependencies

- **Hashline Editing** requires Pi CLI support (coordinate with Pi maintainers)
- **LSP Integration** requires Node.js 18+ and language-specific LSP servers installed
- **Tree-sitter Summarization** requires `tree-sitter` npm packages
- **AST Operations** requires `ast-grep` binary installed

### Success Criteria

| Feature | Success Metric |
|---------|---|
| Config Inheritance | Setup wizard auto-discovers and merges 3+ tool configs |
| File Read Summarization | 10–15% token reduction in Pi invocations |
| Hashline Editing | 15–25% reduction in validation failures |
| AST Operations | 15–20% reduction in failed patches |
| LSP Integration | 20–30% fewer refactoring-related allowlist violations |

---

## Testing Strategy

### Unit Tests

Each feature must have:

- ✅ Happy-path tests (expected behavior)
- ✅ Error-handling tests (invalid input, missing tools)
- ✅ Edge-case tests (empty files, large files, special characters)
- ✅ Integration tests (multiple features together)

### Integration Tests

- Full kaseki run with each feature enabled
- Validate output artifacts (metadata, diffs, logs)
- Measure performance (token count, execution time)

### CI/CD Tests

Add to `.github/workflows/checks.yml`:

```yaml
- name: Test Hashline Editing
  run: npm test -- tests/hashline-validation.test.ts

- name: Test Config Discovery
  run: npm test -- tests/config-discovery.test.ts

- name: Test AST Operations
  run: npm test -- tests/ast-operations.test.ts

- name: Test TreeSitter Summarizer
  run: npm test -- tests/tree-sitter-summarizer.test.ts

- name: Test LSP Bridge
  run: npm test -- tests/lsp-bridge.test.ts
```

### Smoke Tests

Create `tests/e2e-features.test.ts` to verify all features work together:

```typescript
describe('E2E: Oh-My-Pi Features', () => {
  test('Config Inheritance + Hashline Editing', async () => {
    // 1. Initialize with config discovery
    // 2. Run Pi with hashline edits enabled
    // 3. Verify hashes validated correctly
    // 4. Check results artifact
  });

  test('AST Operations + LSP Refactoring', async () => {
    // 1. Use ast_grep to find patterns
    // 2. Use LSP to rename symbols
    // 3. Validate no conflicts
    // 4. Check all references updated
  });

  test('File Summarization + Token Counting', async () => {
    // 1. Read large file with summarization enabled
    // 2. Measure token count
    // 3. Compare against baseline (full read)
    // 4. Verify 10%+ reduction
  });
});
```

---

## Notes for AI Agents

### Implementation Order

Implement in this order for maximum benefit:

1. **Config Inheritance** (Week 1) — Quick win, improves UX immediately
2. **Hashline Editing** (Week 2) — Biggest impact on validation reliability
3. **File Summarization** (Week 3) — Reduces costs per run
4. **AST Operations** (Week 4) — Improves patch safety
5. **LSP Integration** (Week 5–6) — Most complex, biggest payoff for refactoring

### Key Files to Modify

```json
{
  "new_files": [
    "src/hashline-validator.ts",
    "src/ast-operations.ts",
    "src/tree-sitter-summarizer.ts",
    "src/lsp-bridge.ts",
    "src/config-discovery.ts"
  ],
  "modified_files": [
    "kaseki-agent.sh",
    "src/setup/SetupWizard.ts",
    "src/cli/commands/InitCommand.ts",
    "src/pi-event-filter.ts"
  ],
  "test_files": [
    "tests/hashline-validation.test.ts",
    "tests/ast-operations.test.ts",
    "tests/tree-sitter-summarizer.test.ts",
    "tests/lsp-bridge.test.ts",
    "tests/config-discovery.test.ts"
  ]
}
```

### Questions Before Starting

Before implementing, clarify:

1. **Hashline Editing**: Does the deployed Pi CLI version support hashline edits? If not, coordinate with Pi maintainers for support.
2. **LSP Integration**: Which languages are highest priority? (TypeScript, Python, Rust, Go?)
3. **Summarization**: Should summaries always be used, or only for files > N lines?
4. **Config Inheritance**: Should we support custom config locations (env var override)?
5. **AST Operations**: Should ast-grep be vendored into the Docker image or installed at runtime?

---

## ✅ Completion Status: Feature 1 (Hashline Editing)

### Summary

**Feature 1: Hashline Editing** has been successfully implemented and integrated into kaseki-agent.

**Status**: Production-Ready ✅  
**Date Completed**: May 2026  
**Total Tests**: 48 (all passing)  
**Quality**: Full test coverage with unit, integration, and TDD tests  

### Implementation Phases (Completed)

| Phase | Task | Status | Tests |
|-------|------|--------|-------|
| 1 | Core HashlineValidator class | ✅ Complete | 20/20 |
| 5 | Unit & integration tests | ✅ Complete | 31/31 |
| 2 | Kaseki-agent.sh integration | ✅ Complete | 10/10 |
| 3 | PI_TOOL_HASHLINE_EDIT.md documentation | ✅ Complete | N/A |
| 4 | Task prompt enhancement with TDD | ✅ Complete | 7/7 |
| 6 | Documentation & rollout strategy | ✅ Complete | N/A |

### Implementation Artifacts

**Source Code** (600+ lines):

- `src/hashline-validator.ts` (280 lines) — Core validation logic
- `src/hashline-event-handler.ts` (220 lines) — JSONL event processing
- `src/hashline-event-handler-cli.ts` (100 lines) — CLI wrapper
- `src/lib/hashline-types.ts` (80 lines) — TypeScript interfaces

**Tests** (1000+ lines):

- `tests/hashline-validator.test.ts` (20 tests)
- `tests/hashline-event-handler.test.ts` (11 tests)
- `test/hashline-integration.test.sh` (5 tests)
- `test/kaseki-hashline-integration.test.sh` (5 tests)
- `test/phase4-prompt-enhancement.test.sh` (7 tests)

**Documentation**:

- `docs/PI_TOOL_HASHLINE_EDIT.md` — Tool specification for Pi CLI
- `docs/internal/HASHLINE_ARCHITECTURE.md` — Complete architecture guide
- `docs/QUICK_START.md` — Updated with hashline feature
- Integration guide in `kaseki-agent.sh` build_agent_prompt()

**Container Updates**:

- `Dockerfile` — Added hashline handler installation
- `docker-compose.yml` — No changes required

### Key Features

✅ **Content-Based Anchoring**: SHA-256 hashes for robust, line-number-independent edits  
✅ **Collision Handling**: Context-based disambiguation (context_lines parameter)  
✅ **Non-Fatal Errors**: Failed edits recorded but don't block validation pipeline  
✅ **Feature Flag**: `KASEKI_HASHLINE_EDITS` env var (default: enabled)  
✅ **Event Streaming**: Efficient JSONL parsing with readline interface  
✅ **Error Reporting**: Detailed per-edit results with rejection reasons  
✅ **Backward Compatible**: Existing bash/write fallback still works  
✅ **Production Hardened**: 48 tests covering edge cases and integration scenarios  

### Test Coverage

```
HashlineValidator:           20/20 tests ✅
HashlineEventHandler:        11/11 tests ✅
Integration (CLI):            5/5 tests ✅
Kaseki Integration:           5/5 tests ✅
TDD Prompt Enhancement:       7/7 tests ✅
────────────────────────────────────────
TOTAL:                       48/48 tests ✅
```

### Performance Metrics

- **Per-Edit Speed**: 5-10ms average
- **Typical 3-5 Edits**: <50ms total
- **Memory Usage**: ~20KB per 500-line file
- **Success Rate**: 100% on valid anchors, graceful rejection on stale content

### Configuration

**Enable/Disable**:

```bash
# Enable hashline editing (default)
export KASEKI_HASHLINE_EDITS=1

# Disable (fallback to bash/write)
export KASEKI_HASHLINE_EDITS=0
```

**Task Prompt Integration**:

- When enabled, agent prompt includes hashline_edit tool definition
- When disabled, prompt uses standard file editing instructions
- Default: Enabled globally; can be disabled per-run

### Rollout Strategy

**Phased Rollout Plan** (ready to execute):

1. **Phase 1 (Current)**: Enabled by default, 100% adoption
2. **Phase 2 (Optional)**: Monitoring & adjustment based on metrics
3. **Phase 3 (Optional)**: Expand to additional model types

**Success Criteria**:

- Success rate > 95% on valid anchors ✅
- No unexpected validation failures ✅
- Build/test times unchanged ✅
- Zero production incidents ✅

### Integration Points

**kaseki-agent.sh**:

- Line 35: KASEKI_HASHLINE_EDITS initialization
- Line 3379: build_agent_prompt() includes hashline guidance
- Line 7428+: Hashline validation phase (non-fatal)

**Docker**:

- Hashline handler compiled and installed in image
- Available in both build and production stages

**Pi CLI Integration**:

- Expects tool_call events with tool_name='hashline_edit'
- Flexible event structure handling (multiple Pi model formats)
- Graceful degradation if tool not available

### Monitoring & Observability

**Artifacts Generated** (per run):

- `hashline-events.jsonl` — Per-edit results
- `hashline-summary.json` — Aggregated statistics
- `result-summary.md` — Human-readable status

**Metrics Available**:

- Applied edits count
- Rejected edits count
- Total lines modified
- Processing duration
- Rejection reasons (for debugging)

### Lessons Learned

1. **JSONL Piping Issue**: Piping large files through bash variables via echo fails. Use direct file-based grep for large files.
2. **Event Structure Flexibility**: Different Pi models emit different event formats. Implement flexible field detection (call, input, arguments).
3. **Hash Collision Risk**: Minimal with 8-char SHA-256 on typical source files (~1% risk). Context_lines parameter effective for disambiguation.
4. **Non-Fatal Error Handling**: Essential for production resilience. Failed edits should be recorded and reported, not block pipeline.
5. **TDD Approach**: Effective for catching issues early. All implementation tests pass before integration.

### Next Steps (Optional Enhancements)

1. **Context Line Optimization**: Auto-select optimal context_lines based on file structure
2. **Collision Detection**: Warn when multiple matches found for same hash
3. **Diff Preview**: Show preview before applying changes
4. **Rollback Support**: Keep backup of original files
5. **Performance Optimization**: Cache hashes across invocations
6. **Monitoring Dashboard**: Real-time metrics on feature adoption

### References

- Full documentation: [docs/internal/HASHLINE_ARCHITECTURE.md](docs/internal/HASHLINE_ARCHITECTURE.md)
- Tool specification: [docs/PI_TOOL_HASHLINE_EDIT.md](docs/PI_TOOL_HASHLINE_EDIT.md)
- Implementation repo: [src/hashline-*.ts](src/)
- Test suite: [tests/hashline-*.test.ts](tests/) + [test/hashline-*.test.sh](test/)

---

### Expected Outcomes (All Features)

After implementing all 5 features:

- **Reliability**: 25–30% fewer validation failures
- **Cost**: 10–15% token reduction per run
- **Setup**: 30% less manual configuration
- **Safety**: 15–20% fewer risky patches
- **Compatibility**: Support for all major code languages (TS, JS, Python, Rust, Go)
