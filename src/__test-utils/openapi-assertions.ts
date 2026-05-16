/**
 * Shared OpenAPI test assertion helpers
 * Reduces complexity of openapi-spec-generator.test.ts by extracting common patterns
 * @jest-environment node
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
 * Assert that a specific endpoint has a given HTTP status code documented in responses
 */
export function assertStatusCode(
  spec: Record<string, unknown>,
  endpoint: string,
  method: string,
  statusCode: string | number
): void {
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const pathItem = paths?.[endpoint];
  const operation = pathItem?.[method.toLowerCase()] as Record<string, unknown>;
  const responses = operation?.responses as Record<string, unknown>;

  expect(responses).toBeDefined();
  expect(responses?.[statusCode.toString()]).toBeDefined();
}

/**
 * Assert that a schema property has the expected constraints and types
 */
export function assertSchemaProperty(
  schema: Record<string, Record<string, unknown>>,
  propertyName: string,
  expectedType?: string,
  expectedFormat?: string
): void {
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const property = properties?.[propertyName];

  expect(property).toBeDefined();
  if (expectedType) {
    expect(property?.type).toBe(expectedType);
  }
  if (expectedFormat) {
    expect(property?.format).toBe(expectedFormat);
  }
}

/**
 * Assert that an endpoint requires or doesn't require authentication
 */
export function assertAuthRequired(
  spec: Record<string, unknown>,
  endpoint: string,
  shouldBeProtected: boolean
): void {
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const pathItem = paths?.[endpoint];

  expect(pathItem).toBeDefined();

  Object.entries(pathItem as Record<string, unknown>).forEach(([, operation]) => {
    const op = operation as Record<string, unknown>;
    const security = op.security as Array<Record<string, unknown>>;

    if (shouldBeProtected) {
      expect(security).toBeDefined();
      expect(Array.isArray(security)).toBe(true);
      expect(security?.length).toBeGreaterThan(0);
      expect(security?.[0]?.BearerAuth).toBeDefined();
    } else {
      // Public endpoint: security should be empty array or undefined
      expect(security === undefined || (Array.isArray(security) && security.length === 0)).toBe(true);
    }
  });
}

/**
 * Assert that all operations in a path item have required fields
 */
export function assertPathItemOperationsComplete(
  pathItem: Record<string, Record<string, unknown>>,
  requiredFields: string[]
): void {
  Object.entries(pathItem).forEach(([, operation]) => {
    requiredFields.forEach((field) => {
      expect((operation as Record<string, unknown>)[field]).toBeDefined();
    });
  });
}

/**
 * Assert that a schema is properly structured with type and properties
 */
export function assertSchemaStructure(
  schema: Record<string, unknown>,
  expectedType = 'object'
): void {
  expect(schema.type).toBe(expectedType);
  expect(schema.properties).toBeDefined();
  expect(typeof schema.properties).toBe('object');
}

/**
 * Assert that a field is in the required array of a schema
 */
export function assertFieldRequired(
  schema: Record<string, unknown>,
  fieldName: string
): void {
  const required = schema.required as unknown as Array<string>;
  expect(required).toBeDefined();
  expect(Array.isArray(required)).toBe(true);
  expect(required).toContain(fieldName);
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
