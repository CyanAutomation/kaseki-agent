
import TypeScript from 'tree-sitter-typescript';
import Go from 'tree-sitter-go';

console.log('TypeScript:', TypeScript);
console.log('TypeScript.typescript:', TypeScript.typescript);
console.log('TypeScript.default:', TypeScript.default);
if (TypeScript.default) {
  console.log('TypeScript.default.typescript:', TypeScript.default.typescript);
}

console.log('Go:', Go);
console.log('Go.language:', Go.language);
console.log('Go.default:', Go.default);
if (Go.default) {
  console.log('Go.default.language:', Go.default.language);
}
