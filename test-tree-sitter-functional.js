import assert from 'node:assert/strict';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

const source = `
  import { readFile } from 'node:fs/promises';

  export class FixtureParser {
    async load(path: string): Promise<string> {
      return readFile(path, 'utf-8');
    }
  }
`;

const tree = parser.parse(source);

function findNode(node, type, predicate = () => true) {
  if (node.type === type && predicate(node)) {
    return node;
  }

  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (!child) {
      continue;
    }

    const match = findNode(child, type, predicate);
    if (match) {
      return match;
    }
  }

  return undefined;
}

assert.equal(tree.rootNode.type, 'program');
assert.equal(tree.rootNode.hasError(), false);

const importNode = findNode(tree.rootNode, 'import_statement');
assert.ok(importNode, 'expected parser to identify the import statement');
assert.match(importNode.text, /node:fs\/promises/);

const classNode = findNode(tree.rootNode, 'class_declaration');
assert.ok(classNode, 'expected parser to identify the class declaration');
assert.equal(classNode.childForFieldName('name')?.text, 'FixtureParser');

const methodNode = findNode(classNode, 'method_definition');
assert.ok(methodNode, 'expected parser to identify the method definition');
assert.equal(methodNode.childForFieldName('name')?.text, 'load');
