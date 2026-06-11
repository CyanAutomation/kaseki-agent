/**
 * Go code summarizer using tree-sitter CLI
 * Invokes tree-sitter as a subprocess to parse Go files
 * No native Node.js bindings - works with Node 24 and ARM64
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SupportedLanguage } from './summarizer-config';
import type { CodeElement, CodeSummary } from './tree-sitter-summarizer';

interface TreeSitterNode {
  type: string;
  startPoint: [number, number];
  endPoint: [number, number];
  startIndex: number;
  endIndex: number;
  child?: (index: number) => TreeSitterNode | null;
  children?: TreeSitterNode[];
  text?: string;
}

export class GoCliSummarizer {
  private language: SupportedLanguage;

  constructor(language: SupportedLanguage = 'go') {
    this.language = language;
  }

  /**
   * Summarize Go code using tree-sitter CLI
   * Accepts content string, creates temp file, and parses via CLI
   */
  summarize(contentOrPath: string, timeoutMs: number = 1000): CodeSummary {
    const startTime = performance.now();

    try {
      let filePath: string;
      let isTemp = false;
      let originalSize = 0;

      // Check if contentOrPath is a file path or content string
      if (fs.existsSync(contentOrPath) && fs.statSync(contentOrPath).isFile()) {
        // It's a file path
        filePath = contentOrPath;
        const content = fs.readFileSync(filePath, 'utf-8');
        originalSize = Buffer.byteLength(content, 'utf-8');
      } else {
        // It's content - create a temp file
        isTemp = true;
        originalSize = Buffer.byteLength(contentOrPath, 'utf-8');
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `go-parse-${Date.now()}-${Math.random().toString(36).slice(2)}.go`);
        fs.writeFileSync(tmpFile, contentOrPath, 'utf-8');
        filePath = tmpFile;
      }

      try {
        // Call tree-sitter CLI to parse file
        const jsonOutput = execFileSync('tree-sitter', ['parse', filePath, '--json'], {
          encoding: 'utf-8',
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          stdio: ['ignore', 'pipe', 'pipe'], // Capture stderr for better error reporting
        });

        // Parse JSON output
        const tree = JSON.parse(jsonOutput);

        // Extract structure from tree using file content
        const content = fs.readFileSync(filePath, 'utf-8');
        const summary = this.extractStructure(tree, content);

        return {
          ...summary,
          language: this.language,
          originalSizeBytes: originalSize,
          summaryTimeMs: performance.now() - startTime,
        };
      } catch (error: any) {
        // If tree-sitter CLI is not available or fails, return graceful degradation
        let parseError = 'Unknown parsing error';
        
        if (error.code === 'ENOENT' || (error.message && error.message.includes('ENOENT'))) {
          parseError = 'tree-sitter-cli not available (ENOENT)';
        } else if (error.stderr) {
          parseError = `tree-sitter-cli failed: ${error.stderr.toString().trim()}`;
        } else if (error.message) {
          parseError = `tree-sitter-cli error: ${error.message}`;
        }

        return {
          language: this.language,
          imports: [],
          exports: [],
          classes: [],
          functions: [],
          types: [],
          interfaces: [],
          parseError,
          originalSizeBytes: originalSize,
          summaryTimeMs: performance.now() - startTime,
        };
      } finally {
        // Clean up temp file if we created one
        if (isTemp) {
          try {
            fs.unlinkSync(filePath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    } catch (error) {
      const elapsed = performance.now() - startTime;
      return {
        language: this.language,
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        types: [],
        interfaces: [],
        parseError: error instanceof Error ? error.message : String(error),
        originalSizeBytes: 0,
        summaryTimeMs: elapsed,
      };
    }
  }

  private extractStructure(tree: TreeSitterNode, source: string): Omit<CodeSummary, 'language' | 'originalSizeBytes' | 'summaryTimeMs'> {
    const summary = {
      imports: [] as Array<{ module: string; items: string[] }>,
      exports: [] as Array<{ name: string; kind: string }>,
      classes: [] as Array<{ name: string; methods: CodeElement[] }>,
      functions: [] as CodeElement[],
      types: [] as CodeElement[],
      interfaces: [] as CodeElement[],
    };

    if (tree && tree.children) {
      for (const child of tree.children) {
        this.visit(child, source, summary);
      }
    }

    return summary;
  }

  private visit(node: TreeSitterNode, source: string, summary: any): void {
    if (!node) return;

    // Extract imports
    if (node.type === 'import_declaration') {
      this.extractImport(node, source, summary);
    }

    // Extract type declarations (structs, interfaces, etc.)
    if (node.type === 'type_declaration') {
      this.extractTypeDeclaration(node, source, summary);
    }

    // Extract function declarations
    if (node.type === 'function_declaration') {
      this.extractFunction(node, source, summary);
    }

    // Extract method declarations
    if (node.type === 'method_declaration') {
      this.extractMethod(node, source, summary);
    }

    // Recursively visit children
    if (node.children) {
      for (const child of node.children) {
        this.visit(child, source, summary);
      }
    }
  }

  private extractImport(node: TreeSitterNode, source: string, summary: any): void {
    // Find import spec child nodes
    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'import_spec_list' && child.children) {
          for (const spec of child.children) {
            if (spec.type === 'import_spec') {
              const text = source.substring(spec.startIndex, spec.endIndex);
              const match = text.match(/['"]([^'"]+)['"]/);
              if (match) {
                summary.imports.push({ module: match[1], items: [] });
              }
            }
          }
        } else if (child.type === 'import_spec') {
          const text = source.substring(child.startIndex, child.endIndex);
          const match = text.match(/['"]([^'"]+)['"]/);
          if (match) {
            summary.imports.push({ module: match[1], items: [] });
          }
        }
      }
    }
  }

  private extractTypeDeclaration(node: TreeSitterNode, source: string, summary: any): void {
    // Type declarations can contain type_spec nodes
    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'type_spec') {
          this.extractTypeSpec(child, source, summary);
        }
      }
    }
  }

  private extractTypeSpec(node: TreeSitterNode, source: string, summary: any): void {
    // Get the name (first identifier)
    let name = '';
    let kind = 'type';

    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'type_identifier') {
          name = source.substring(child.startIndex, child.endIndex);
          break;
        }
      }

      // Check if this is a struct or interface
      for (const child of node.children) {
        if (child.type === 'struct_type') {
          kind = 'struct';
          this.extractStruct(name, child, source, summary);
          return;
        } else if (child.type === 'interface_type') {
          kind = 'interface';
        }
      }
    }

    if (name) {
      if (kind === 'struct') {
        // Already handled above
        return;
      }
      if (!summary.types.some((t: any) => t.name === name)) {
        summary.types.push({ name, signature: `type ${name}`, kind: 'type' });
      }
    }
  }

  private extractStruct(structName: string, _node: TreeSitterNode, _source: string, summary: any): void {
    if (!structName) return;

    // Check if already exists
    if (summary.classes.some((c: any) => c.name === structName)) return;

    const methods: CodeElement[] = [];
    // Methods will be extracted separately via method_declaration nodes
    // that reference this struct via their receiver

    summary.classes.push({ name: structName, methods });
  }

  private extractFunction(node: TreeSitterNode, source: string, summary: any): void {
    // Get function name (identifier child)
    let name = '';

    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'identifier') {
          name = source.substring(child.startIndex, child.endIndex);
          break;
        }
      }
    }

    if (name && !summary.functions.some((f: any) => f.name === name)) {
      const signature = source.substring(node.startIndex, node.startIndex + 100); // First 100 chars
      summary.functions.push({ name, signature, kind: 'function' });
    }
  }

  private extractMethod(node: TreeSitterNode, source: string, summary: any): void {
    // Method declaration has a receiver
    // func (receiver ReceiverType) MethodName(params) ReturnType

    let methodName = '';
    let receiverType = '';

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];

        // Receiver is typically in a parameter_list after 'func'
        if (child.type === 'parameter_list' && i === 0) {
          // This is the receiver list - extract type name
          const text = source.substring(child.startIndex, child.endIndex);
          // Match pattern: (name Type) or (name *Type)
          const match = text.match(/\(\s*\w+\s+\*?(\w+)\s*\)/);
          if (match) {
            receiverType = match[1];
          }
        }

        // Method name is identifier after first parameter_list
        if (child.type === 'identifier' && receiverType) {
          methodName = source.substring(child.startIndex, child.endIndex);
          break;
        }
      }
    }

    if (methodName && receiverType) {
      // Add to class (struct) methods
      let classEntry = summary.classes.find((c: any) => c.name === receiverType);
      if (!classEntry) {
        classEntry = { name: receiverType, methods: [] };
        summary.classes.push(classEntry);
      }

      if (!classEntry.methods.some((m: any) => m.name === methodName)) {
        const signature = source.substring(node.startIndex, node.startIndex + 100);
        classEntry.methods.push({ name: methodName, signature, kind: 'method' });
      }
    }
  }
}
