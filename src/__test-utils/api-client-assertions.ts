/**
 * Minimal OpenAPI test assertion helpers
 * Extracted from patterns in openapi-spec-generator.test.ts
 * Reduces boilerplate and improves test maintainability
 */

// Jest globals are available in test contexts; expect is injected by Jest
declare const expect: jest.Expect;

/**
 * Iterate through all paths and methods in an OpenAPI spec, executing a callback for each
 * Replaces nested Object.entries().forEach() patterns with a single helper call
 */
export function forEachPathOperation(
  paths: Record<string, Record<string, unknown>>,
  callback: (pathName: string, method: string, operation: Record<string, unknown>) => void
): void {
  Object.entries(paths).forEach(([pathName, pathItem]) => {
    Object.entries(pathItem as Record<string, unknown>).forEach(([method, operation]) => {
      callback(pathName, method, operation as Record<string, unknown>);
    });
  });
}

/**
 * Assert that all paths have at least one operation defined (GET, POST, etc.)
 */
export function assertAllPathsHaveOperations(paths: Record<string, Record<string, unknown>>): void {
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

  Object.entries(paths).forEach(([, pathItem]) => {
    const hasOperation = httpMethods.some((method) => method in pathItem);
    expect(hasOperation).toBe(true);
  });
}
