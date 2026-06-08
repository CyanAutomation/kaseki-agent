/**
 * Tree-sitter based code summarizer
 * Extracts code structure (classes, functions, types, imports) without implementations
 */
import Parser from 'tree-sitter';
import { SupportedLanguage } from './summarizer-config';

import TypeScript from 'tree-sitter-typescript';
import Go from 'tree-sitter-go';

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
 * Tree-sitter summarizer for code structure extraction
 */
export class TreeSitterSummarizer {
  private parser: Parser;
  private language: SupportedLanguage;

  constructor(language: SupportedLanguage = 'typescript') {
    this.parser = new Parser();
    this.language = language;

    try {
      this.initializeLanguage(language);
      console.log(`Initialized tree-sitter for ${language}`);
    } catch (error) {
      console.error(`Failed to initialize tree-sitter for ${language}:`, error);
      throw new Error(`Failed to initialize tree-sitter for ${language}: ${error}`);
    }
  }

  private initializeLanguage(language: SupportedLanguage): void {
    let lang: any;
    switch (language) {
    case 'typescript': {
      lang = (TypeScript as any).typescript || (TypeScript as any).default?.typescript;
      break;
    }
    case 'javascript': {
      // JavaScript uses the same grammar as TypeScript in tree-sitter
      lang = (TypeScript as any).typescript || (TypeScript as any).default?.typescript;
      break;
    }
    case 'go': {
      lang = (Go as any).language || (Go as any).default?.language;
      break;
    }
    default:
      throw new Error(`Unsupported language: ${language}`);
    }
    if (!lang) {
      console.error(`Could not find language binding for ${language}. TypeScript keys:`, Object.keys(TypeScript as any));
    }
    this.parser.setLanguage(lang);
  }

  /**
   * Summarize file content into code structure
   */
  summarize(content: string, timeoutMs: number = 100): CodeSummary {
    const startTime = performance.now();
    const originalSize = Buffer.byteLength(content, 'utf-8');

    try {
      // Parse with timeout protection
      let tree: Parser.Tree | null = null;
      const parseStart = performance.now();

      try {
        tree = this.parser.parse(content);
        console.log(`Parsed content (${content.length} chars). Root type: ${tree?.rootNode.type}, childCount: ${tree?.rootNode.childCount}`);
      } catch (parseError) {
        const parseTime = performance.now() - parseStart;
        if (parseTime > timeoutMs) {
          return {
            language: this.language,
            imports: [],
            exports: [],
            classes: [],
            functions: [],
            types: [],
            interfaces: [],
            parseError: `Parse timeout after ${parseTime.toFixed(0)}ms`,
            originalSizeBytes: originalSize,
            summaryTimeMs: parseTime,
          };
        }
        throw parseError;
      }

      if (!tree) {
        throw new Error('Failed to parse content');
      }

      // Extract structure
      const summary = this.extractStructure(tree, content);
      const summaryTime = performance.now() - startTime;

      return {
        ...summary,
        parseError: tree.rootNode.hasError ? 'Syntax error' : summary.parseError,
        originalSizeBytes: originalSize,
        summaryTimeMs: summaryTime,
      };
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
        originalSizeBytes: originalSize,
        summaryTimeMs: elapsed,
      };
    }
  }

  private extractStructure(tree: Parser.Tree, source: string): Omit<CodeSummary, 'originalSizeBytes' | 'summaryTimeMs'> {
    const summary: Omit<CodeSummary, 'originalSizeBytes' | 'summaryTimeMs'> = {
      language: this.language,
      imports: [],
      exports: [],
      classes: [],
      functions: [],
      types: [],
      interfaces: [],
    };

    this.traverse(tree.rootNode, source, summary);
    return summary;
  }

  private traverse(node: Parser.SyntaxNode, source: string, summary: any): void {
    // Extract based on node type
    switch (this.language) {
    case 'typescript':
    case 'javascript':
      this.traverseTypeScript(node, source, summary);
      break;
    case 'go':
      this.traverseGo(node, source, summary);
      break;
    }

    // Recursively traverse children
    for (const child of node.children) {
      this.traverse(child, source, summary);
    }
  }

  private traverseTypeScript(node: Parser.SyntaxNode, source: string, summary: any): void {
    const type = node.type;

    // Extract imports
    if (type === 'import_statement') {
      this.extractTSImport(node, source, summary);
    }

    // Extract exports
    if (type === 'export_statement') {
      this.extractTSExport(node, source, summary);
    }

    // Extract class declarations
    if (type === 'class_declaration') {
      this.extractTSClass(node, source, summary);
    }

    // Extract function declarations
    if (type === 'function_declaration') {
      this.extractTSFunction(node, source, summary);
    }

    // Extract type aliases
    if (type === 'type_alias_declaration') {
      this.extractTSType(node, source, summary);
    }

    // Extract interface declarations
    if (type === 'interface_declaration') {
      this.extractTSInterface(node, source, summary);
    }
  }

  private traverseGo(node: Parser.SyntaxNode, source: string, summary: any): void {
    const type = node.type;

    // Extract imports
    if (type === 'import_declaration' || type === 'import_spec') {
      this.extractGoImport(node, source, summary);
    }

    // Extract type declarations
    if (type === 'type_declaration') {
      this.extractGoType(node, source, summary);
    }

    // Extract function declarations
    if (type === 'function_declaration') {
      this.extractGoFunction(node, source, summary);
    }

    // Extract method declarations
    if (type === 'method_declaration') {
      this.extractGoMethod(node, source, summary);
    }
  }

  // TypeScript extraction methods

  private extractTSImport(node: Parser.SyntaxNode, source: string, summary: any): void {
    // Extract import { a, b } from 'module'
    const text = this.getNodeText(node, source);
    const match = text.match(/from\s+['"]([^'"]+)['"]/);
    if (match) {
      const module = match[1];
      const items = this.extractTSImportItems(text);
      summary.imports.push({ module, items });
    }
  }

  private extractTSImportItems(text: string): string[] {
    const match = text.match(/import\s+(?:\*\s+as\s+(\w+)|\{([^}]+)\})/);
    if (!match) return [];

    if (match[1]) return [match[1]]; // import * as X

    return match[2]
      .split(',')
      .map((item) => item.trim().split(' as ')[0])
      .filter((item) => item);
  }

  private extractTSExport(node: Parser.SyntaxNode, source: string, summary: any): void {
    // Extract export class, function, const, etc.
    const child = node.child(1); // Skip 'export' keyword
    if (!child) return;

    let name = '';
    let kind = 'unknown';

    if (child.type === 'class_declaration') {
      name = this.extractName(child, source);
      kind = 'class';
    } else if (child.type === 'function_declaration') {
      name = this.extractName(child, source);
      kind = 'function';
    } else if (child.type === 'const_statement' || child.type === 'variable_declaration') {
      name = this.extractName(child, source);
      kind = 'const';
    }

    if (name) {
      summary.exports.push({ name, kind });
    }
  }

  private extractTSClass(node: Parser.SyntaxNode, source: string, summary: any): void {
    const name = this.extractName(node, source);
    if (!name) return;

    const methods: CodeElement[] = [];

    // Extract methods
    for (const child of node.children) {
      if (child.type === 'method_definition') {
        const methodName = this.extractName(child, source);
        if (methodName) {
          const signature = this.getNodeText(child, source).split('\n')[0];
          methods.push({ name: methodName, signature, kind: 'method' });
        }
      }
    }

    summary.classes.push({ name, methods });
  }

  private extractTSFunction(node: Parser.SyntaxNode, source: string, summary: any): void {
    const name = this.extractName(node, source);
    if (!name) return;

    const signature = this.getNodeText(node, source).split('\n')[0];
    summary.functions.push({ name, signature, kind: 'function' });
  }

  private extractTSType(node: Parser.SyntaxNode, source: string, summary: any): void {
    const name = this.extractName(node, source);
    if (!name) return;

    const signature = this.getNodeText(node, source).split('\n')[0];
    summary.types.push({ name, signature, kind: 'type' });
  }

  private extractTSInterface(node: Parser.SyntaxNode, source: string, summary: any): void {
    const name = this.extractName(node, source);
    if (!name) return;

    const signature = this.getNodeText(node, source).split('\n')[0];
    summary.interfaces.push({ name, signature, kind: 'interface' });
  }

  // Go extraction methods

  private extractGoImport(node: Parser.SyntaxNode, source: string, summary: any): void {
    const text = this.getNodeText(node, source);
    const match = text.match(/['"]([^'"]+)['"]/);
    if (match) {
      summary.imports.push({ module: match[1], items: [] });
    }
  }

  private extractGoType(node: Parser.SyntaxNode, source: string, summary: any): void {
    // Extract type definitions
    for (const child of node.children) {
      if (child.type === 'type_spec') {
        const name = this.extractName(child, source);
        if (name) {
          const signature = this.getNodeText(child, source).split('\n')[0];
          summary.types.push({ name, signature, kind: 'type' });
        }
      }
    }
  }

  private extractGoFunction(node: Parser.SyntaxNode, source: string, summary: any): void {
    const name = this.extractName(node, source);
    if (!name) return;

    const signature = this.getNodeText(node, source).split('\n')[0];
    summary.functions.push({ name, signature, kind: 'function' });
  }

  private extractGoMethod(node: Parser.SyntaxNode, source: string, summary: any): void {
    // Go methods are receiver functions - extract receiver type
    const name = this.extractName(node, source);
    if (!name) return;

    const signature = this.getNodeText(node, source).split('\n')[0];

    // Find or create class for receiver type
    const receiverMatch = signature.match(/func\s+\(\s*\w+\s+\*?(\w+)\s*\)/);
    if (receiverMatch) {
      const className = receiverMatch[1];
      let classEntry = summary.classes.find((c: any) => c.name === className);
      if (!classEntry) {
        classEntry = { name: className, methods: [] };
        summary.classes.push(classEntry);
      }
      classEntry.methods.push({ name, signature, kind: 'method' });
    }
  }

  // Utility methods

  private extractName(node: Parser.SyntaxNode, source: string): string {
    // Find identifier node
    for (const child of node.children) {
      if (child.type === 'identifier') {
        return this.getNodeText(child, source);
      }
      if (child.type === 'type_identifier') {
        return this.getNodeText(child, source);
      }
    }
    return '';
  }

  private getNodeText(node: Parser.SyntaxNode, source: string): string {
    return source.substring(node.startIndex, node.endIndex);
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
