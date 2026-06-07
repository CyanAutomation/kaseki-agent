import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

try {
  const parser = new Parser();
  parser.setLanguage(TypeScript.typescript);
  const tree = parser.parse('class A {}');
  console.log('Root node type:', tree.rootNode.type);
  console.log('Root node child count:', tree.rootNode.childCount);
  console.log('First child type:', tree.rootNode.child(0)?.type);
  console.log('Tree-sitter functional test passed');
} catch (e) {
  console.error('Tree-sitter functional test failed:', e);
}
