
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

const parser = new Parser();
parser.setLanguage(TypeScript);

const sourceCode = 'class AuthManager { login() {} }';
const tree = parser.parse(sourceCode);

console.log('Root node type:', tree.rootNode.type);
console.log('Child count:', tree.rootNode.childCount);
for (let i = 0; i < tree.rootNode.childCount; i++) {
  console.log(`Child ${i} type:`, tree.rootNode.child(i).type);
}
