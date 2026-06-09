/**
 * Hybrid code summarizer dispatcher
 * Uses TypeScript Compiler API for TS/JS files (pure JavaScript, no native deps)
 * Uses tree-sitter CLI for Go files (subprocess, no Node binding issues)
 * Works with Node 24 and ARM64/Raspberry Pi
 */
import { SupportedLanguage } from './summarizer-config';
import { TypeScriptCompilerSummarizer } from './typescript-compiler-summarizer';
import { GoCliSummarizer } from './go-cli-summarizer';

export interface CodeElement {
  name: string;
  signature: string;
  kind: 'class' | 'function' | 'method' | 'type' | 'interface' | 'struct';
  line?: number;
}

export interface CodeSummary {
  language: SupportedLanguage;
  imports: Array<{ module: string; items: string[] }>;
  exports: Array<{ name: string; kind: string }>;
  classes: Array<{ name: string; methods: CodeElement[] }>;
  functions: CodeElement[];
  types: CodeElement[];
  interfaces: CodeElement[];
  parseError?: string;
  originalSizeBytes: number;
  summaryTimeMs: number;
}

/**
 * Hybrid summarizer that dispatches to appropriate backend
 * - TypeScript Compiler API for TypeScript/JavaScript
 * - tree-sitter CLI for Go
 */
export class TreeSitterSummarizer {
  private language: SupportedLanguage;
  private tsCompilerSummarizer: TypeScriptCompilerSummarizer | null = null;
  private goCliSummarizer: GoCliSummarizer | null = null;

  constructor(language: SupportedLanguage = 'typescript') {
    this.language = language;

    // Initialize appropriate backend based on language
    if (language === 'typescript' || language === 'javascript') {
      this.tsCompilerSummarizer = new TypeScriptCompilerSummarizer(language);
    } else if (language === 'go') {
      this.goCliSummarizer = new GoCliSummarizer(language);
    }
  }

  /**
   * Summarize code content into code structure
   * For TS/JS: content is the file content string
   * For Go: content is the file content string (internally creates temp file if needed)
   */
  summarize(content: string, timeoutMs: number = 200): CodeSummary {
    try {
      if (this.language === 'go' && this.goCliSummarizer) {
        // For Go, pass content directly - GoCliSummarizer handles temp file creation
        return this.goCliSummarizer.summarize(content, timeoutMs);
      } else if ((this.language === 'typescript' || this.language === 'javascript') && this.tsCompilerSummarizer) {
        // For TS/JS, the parameter is file content
        return this.tsCompilerSummarizer.summarize(content, timeoutMs);
      } else {
        // Unsupported language
        const originalSize = Buffer.byteLength(content, 'utf-8');
        return {
          language: this.language,
          imports: [],
          exports: [],
          classes: [],
          functions: [],
          types: [],
          interfaces: [],
          parseError: `Unsupported language: ${this.language}`,
          originalSizeBytes: originalSize,
          summaryTimeMs: 0,
        };
      }
    } catch (error) {
      const originalSize = Buffer.byteLength(content, 'utf-8');
      return {
        language: this.language,
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        types: [],
        interfaces: [],
        parseError: error instanceof Error ? error.message : String(error),
        originalSizeBytes: originalSize,
        summaryTimeMs: 0,
      };
    }
  }

  /**
   * Format summary as Markdown for Pi
   */
  formatAsMarkdown(summary: CodeSummary): string {
    let output = '';

    if (summary.parseError) {
      output += `<!-- PARSE ERROR: ${summary.parseError} -->\n`;
      output += '<!-- File could not be summarized, full content follows -->\n\n';
      return output;
    }

    // Header with metadata
    output += `<!-- SUMMARY: ${summary.language} | ${summary.originalSizeBytes} bytes | ${summary.summaryTimeMs.toFixed(0)}ms -->\n`;
    output += '<!-- This is a structural summary; use full=true to read implementation details -->\n\n';

    // Imports
    if (summary.imports.length > 0) {
      output += '## Imports\n';
      for (const imp of summary.imports) {
        if (imp.items.length > 0) {
          output += `- From \`${imp.module}\`: ${imp.items.join(', ')}\n`;
        } else {
          output += `- \`${imp.module}\`\n`;
        }
      }
      output += '\n';
    }

    // Exports
    if (summary.exports.length > 0) {
      output += '## Exports\n';
      for (const exp of summary.exports) {
        output += `- ${exp.name} (${exp.kind})\n`;
      }
      output += '\n';
    }

    // Classes/Structs
    if (summary.classes.length > 0) {
      output += '## Classes\n';
      for (const cls of summary.classes) {
        output += `### ${cls.name}\n`;
        for (const method of cls.methods) {
          output += `- ${method.signature}\n`;
        }
        output += '\n';
      }
    }

    // Functions
    if (summary.functions.length > 0) {
      output += '## Functions\n';
      for (const func of summary.functions) {
        output += `- ${func.signature}\n`;
      }
      output += '\n';
    }

    // Types
    if (summary.types.length > 0) {
      output += '## Types\n';
      for (const type of summary.types) {
        output += `- \`${type.name}\`: ${type.signature}\n`;
      }
      output += '\n';
    }

    // Interfaces
    if (summary.interfaces.length > 0) {
      output += '## Interfaces\n';
      for (const iface of summary.interfaces) {
        output += `- \`${iface.name}\`: ${iface.signature}\n`;
      }
      output += '\n';
    }

    return output.trim() + '\n';
  }
}
