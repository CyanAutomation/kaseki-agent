import assert from 'node:assert/strict';

async function main() {
  const [{ default: Parser }, { default: TypeScript }] = await Promise.all([
    import('tree-sitter'),
    import('tree-sitter-typescript'),
  ]);

  const parser = new Parser();
  parser.setLanguage(TypeScript.typescript);

  const tree = parser.parse('class A {}');
  const firstChild = tree.rootNode.child(0);

  assert.equal(tree.rootNode.type, 'program');
  assert.ok(firstChild, 'Expected parsed program to have a first child');
  assert.equal(firstChild.type, 'class_declaration');
  assert.equal(firstChild.text, 'class A {}');

  console.log('Tree-sitter functional smoke test passed');
}

main().catch(error => {
  console.error('Tree-sitter functional smoke test failed:', error);
  process.exitCode = 1;
});
