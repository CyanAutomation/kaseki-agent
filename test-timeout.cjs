
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

const parser = new Parser();
parser.setLanguage(TypeScript);

console.log('Testing timeout...');
parser.setTimeoutMicros(1); // 1 microsecond - should definitely timeout

const sourceCode = 'class AuthManager { login() {} }'.repeat(1000);
const tree = parser.parse(sourceCode);

console.log('Tree:', tree);
if (tree) {
  console.log('Root node type:', tree.rootNode.type);
  console.log('Is error:', tree.rootNode.hasError);
}
