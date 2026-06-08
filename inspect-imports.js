
import Parser from 'tree-sitter';
import * as treeSitter from 'tree-sitter';

console.log('Parser:', Parser);
console.log('treeSitter:', treeSitter);
console.log('treeSitter.default:', treeSitter.default);

try {
  const p = new Parser();
  console.log('Successfully created Parser instance');
} catch (e) {
  console.log('Failed to create Parser instance:', e.message);
}
