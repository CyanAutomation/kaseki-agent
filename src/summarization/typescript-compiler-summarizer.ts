/**
 * TypeScript Compiler API based code summarizer
 * Pure JavaScript implementation using ts.createSourceFile() for AST parsing
 * No native dependencies - works with Node 24 and ARM64
 */
import * as ts from 'typescript';
import { SupportedLanguage } from './summarizer-config';
import type { CodeElement, CodeSummary } from './tree-sitter-summarizer';

export class TypeScriptCompilerSummarizer {
  private language: SupportedLanguage;

  constructor(language: SupportedLanguage = 'typescript') {
    this.language = language;
  }

  /**
   * Summarize TypeScript/JavaScript code using the compiler API
   */
  summarize(content: string, _timeoutMs: number = 200): CodeSummary {
    const startTime = performance.now();
    const originalSize = Buffer.byteLength(content, 'utf-8');

    try {
      // Create source file for parsing
      const sourceFile = ts.createSourceFile(
        `file.${this.language === 'typescript' ? 'ts' : 'js'}`,
        content,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
      );

      // Walk AST and extract structure
      const summary = this.extractStructure(sourceFile, content);

      return {
        ...summary,
        language: this.language,
        originalSizeBytes: originalSize,
        summaryTimeMs: performance.now() - startTime,
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

  private extractStructure(sourceFile: ts.SourceFile, _content: string): Omit<CodeSummary, 'language' | 'originalSizeBytes' | 'summaryTimeMs'> {
    const summary = {
      imports: [] as Array<{ module: string; items: string[] }>,
      exports: [] as Array<{ name: string; kind: string }>,
      classes: [] as Array<{ name: string; methods: CodeElement[] }>,
      functions: [] as CodeElement[],
      types: [] as CodeElement[],
      interfaces: [] as CodeElement[],
    };

    this.visit(sourceFile, summary);
    return summary;
  }

  private visit(node: ts.Node, summary: any): void {
    // Extract imports
    if (ts.isImportDeclaration(node)) {
      this.extractImport(node, summary);
    }

    // Extract exports (check for export modifier on declarations)
    if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) ||
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      this.extractExport(node, summary);
    }

    // Extract class declarations
    if (ts.isClassDeclaration(node)) {
      this.extractClass(node, summary);
    }

    // Extract function declarations
    if (ts.isFunctionDeclaration(node)) {
      this.extractFunction(node, summary);
    }

    // Extract interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      this.extractInterface(node, summary);
    }

    // Extract type aliases
    if (ts.isTypeAliasDeclaration(node)) {
      this.extractType(node, summary);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visit(child, summary));
  }

  private extractImport(node: ts.ImportDeclaration, summary: any): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return;

    const module = moduleSpecifier.text;
    const items: string[] = [];

    if (node.importClause) {
      // import X from 'module'
      if (node.importClause.name) {
        items.push(node.importClause.name.text);
      }

      // import { a, b } from 'module'
      if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const elem of node.importClause.namedBindings.elements) {
          items.push(elem.name.text);
        }
      }

      // import * as X from 'module'
      if (node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) {
        items.push(node.importClause.namedBindings.name.text);
      }
    }

    summary.imports.push({ module, items });
  }

  private extractExport(node: ts.Node, summary: any): void {
    // Check if node has export modifier
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);

    if (!isExported) return; // Not an exported declaration

    let name = '';
    let kind = 'unknown';

    // Check for exported declarations
    if (ts.isClassDeclaration(node)) {
      name = node.name?.text || '';
      kind = 'class';
      this.extractClass(node, summary); // Also extract as class
    } else if (ts.isFunctionDeclaration(node)) {
      name = node.name?.text || '';
      kind = 'function';
      this.extractFunction(node, summary); // Also extract as function
    } else if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
      kind = 'interface';
      this.extractInterface(node, summary);
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
      kind = 'type';
      this.extractType(node, summary);
    }

    if (name) {
      // Check if already exists to avoid duplicates
      if (!summary.exports.some((e: any) => e.name === name)) {
        summary.exports.push({ name, kind });
      }
    }
  }

  private extractClass(node: ts.ClassDeclaration, summary: any): void {
    const name = node.name?.text;
    if (!name) return;

    // Check if already exists to avoid duplicates
    if (summary.classes.some((c: any) => c.name === name)) return;

    const methods: CodeElement[] = [];

    // Extract methods (but not constructors)
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member)) {
        const methodName = (member.name as ts.Identifier)?.text;
        if (methodName) {
          const signature = this.getSignature(member);
          methods.push({
            name: methodName,
            signature,
            kind: 'method',
          });
        }
      }
      // Skip constructors and other members
    }

    summary.classes.push({ name, methods });
  }

  private extractFunction(node: ts.FunctionDeclaration, summary: any): void {
    const name = node.name?.text;
    if (!name) return;

    // Check if already exists to avoid duplicates
    if (summary.functions.some((f: any) => f.name === name)) return;

    const signature = this.getSignature(node);
    summary.functions.push({ name, signature, kind: 'function' });
  }

  private extractInterface(node: ts.InterfaceDeclaration, summary: any): void {
    const name = node.name.text;
    if (!name) return;

    if (summary.interfaces.some((i: any) => i.name === name)) return;

    const signature = `interface ${name}`;
    summary.interfaces.push({ name, signature, kind: 'interface' });
  }

  private extractType(node: ts.TypeAliasDeclaration, summary: any): void {
    const name = node.name.text;
    if (!name) return;

    if (summary.types.some((t: any) => t.name === name)) return;

    const signature = `type ${name}`;
    summary.types.push({ name, signature, kind: 'type' });
  }

  private getSignature(node: ts.Declaration): string {
    const printer = ts.createPrinter();
    const signature = printer.printNode(ts.EmitHint.Unspecified, node as any, undefined as any);
    // Return just the first line to keep signatures concise
    return signature.split('\n')[0];
  }
}
