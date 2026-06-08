
import { describe, it } from '@jest/globals';

describe('Actual Go', () => {
  it('should be real', () => {
    const Go = jest.requireActual('tree-sitter-go') as any;
    console.log('Actual Go keys:', Object.keys(Go));
    console.log('Actual Go default keys:', Go.default ? Object.keys(Go.default) : 'none');
  });
});
