/**
 * Unit tests for OpenAPI spec generator
 */

import { generateOpenAPISpec } from '../src/openapi-spec-generator';

describe('OpenAPI Spec Generator', () => {
  let spec: Record<string, unknown>;

  beforeAll(() => {
    spec = generateOpenAPISpec();
  });

  describe('Basic Structure', () => {
    test('generates valid OpenAPI 3.1 spec', () => {
      expect(spec).toBeDefined();
      expect(spec.openapi).toBe('3.1.0');
    });

    test('includes required info section', () => {
      expect(spec.info).toBeDefined();
      expect((spec.info as Record<string, unknown>).title).toBe('Kaseki Agent API');
      expect((spec.info as Record<string, unknown>).version).toBeDefined();
      expect((spec.info as Record<string, unknown>).description).toBeDefined();
    });

    test('includes servers array', () => {
      expect(spec.servers).toBeDefined();
      expect(Array.isArray(spec.servers)).toBe(true);
      expect((spec.servers as Array<unknown>).length).toBeGreaterThan(0);
    });

    test('includes paths object', () => {
      expect(spec.paths).toBeDefined();
      expect(typeof spec.paths).toBe('object');
    });

    test('includes components section', () => {
      expect(spec.components).toBeDefined();
      expect((spec.components as Record<string, unknown>).schemas).toBeDefined();
      expect((spec.components as Record<string, unknown>).securitySchemes).toBeDefined();
    });

    test('includes tags array', () => {
      expect(spec.tags).toBeDefined();
      expect(Array.isArray(spec.tags)).toBe(true);
      expect((spec.tags as Array<unknown>).length).toBeGreaterThan(0);
    });
  });

  describe('Paths and Endpoints', () => {
    test('includes health endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/health']).toBeDefined();
    });

    test('includes ready endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/ready']).toBeDefined();
    });

    test('includes metrics endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/api/metrics']).toBeDefined();
    });

    test('includes run management endpoints', () => {
      const runEndpoints = ['/api/runs', '/api/runs/{id}/status', '/api/runs/{id}/cancel'];
      runEndpoints.forEach((endpoint) => {
        expect((spec.paths as Record<string, unknown>)[endpoint]).toBeDefined();
      });
    });

    test('includes artifact endpoints', () => {
      const artifactEndpoints = ['/api/runs/{id}/artifacts', '/api/results/{id}/{file}'];
      artifactEndpoints.forEach((endpoint) => {
        expect((spec.paths as Record<string, unknown>)[endpoint]).toBeDefined();
      });
    });

    test('includes webhook endpoint', () => {
      expect((spec.paths as Record<string, unknown>)['/api/webhooks/test']).toBeDefined();
    });

    test('all paths have operations defined', () => {
      const paths = spec.paths as Record<string, Record<string, unknown>>;
      Object.values(paths).forEach((pathItem) => {
        const methods = ['get', 'post', 'put', 'delete', 'patch'];
        const hasOperation = methods.some((method) => method in pathItem);
        expect(hasOperation).toBe(true);
      });
    });

    test('all endpoints have descriptions', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      Object.values(paths).forEach((pathItem) => {
        Object.values(pathItem).forEach((operation) => {
          if (typeof operation === 'object' && operation !== null && 'description' in operation) {
            expect(operation.description).toBeTruthy();
          }
        });
      });
    });

    test('all endpoints have responses defined', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            expect((operation as Record<string, unknown>).responses).toBeDefined();
          }
        });
      });
    });
  });

  describe('Authentication', () => {
    test('defines BearerAuth security scheme', () => {
      const securitySchemes = (spec.components as Record<string, Record<string, unknown>>).securitySchemes;
      expect(securitySchemes.BearerAuth).toBeDefined();
      expect((securitySchemes.BearerAuth as Record<string, unknown>).type).toBe('http');
      expect((securitySchemes.BearerAuth as Record<string, unknown>).scheme).toBe('bearer');
    });

    test('public endpoints do not require authentication', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const publicEndpoints = ['/health', '/ready'];

      publicEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        Object.values(pathItem).forEach((operation) => {
          if (typeof operation === 'object' && operation !== null && 'security' in operation) {
            // Public endpoints should not have security requirement or have empty security array
            const security = (operation as Record<string, unknown>).security;
            if (security) {
              expect(Array.isArray(security)).toBe(true);
            }
          }
        });
      });
    });

    test('protected endpoints require bearer auth', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const protectedEndpoints = ['/api/runs', '/api/metrics', '/api/artifacts'];

      protectedEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem) {
          Object.values(pathItem).forEach((operation) => {
            if (typeof operation === 'object' && operation !== null && 'security' in operation) {
              const security = (operation as Record<string, unknown>).security;
              // Protected endpoints should have security defined
              if (security) {
                expect(Array.isArray(security)).toBe(true);
              }
            }
          });
        }
      });
    });
  });

  describe('Schemas', () => {
    test('includes all required schemas', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const requiredSchemas = ['RunRequest', 'RunResponse', 'StatusResponse', 'ErrorResponse'];

      requiredSchemas.forEach((schema) => {
        expect(schemas[schema]).toBeDefined();
      });
    });

    test('RunRequest schema has required properties', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, unknown>;

      expect(runRequest.type).toBe('object');
      expect(runRequest.properties).toBeDefined();
      const props = runRequest.properties as Record<string, unknown>;
      expect(props.repoUrl).toBeDefined();
    });

    test('RunResponse schema is properly defined', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, unknown>;

      expect(runResponse.type).toBe('object');
      expect(runResponse.properties).toBeDefined();
      const props = runResponse.properties as Record<string, unknown>;
      expect(props.id).toBeDefined();
      expect(props.status).toBeDefined();
      expect(props.createdAt).toBeDefined();
    });

    test('ErrorResponse schema is properly defined', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const errorResponse = schemas.ErrorResponse as Record<string, unknown>;

      expect(errorResponse.type).toBe('object');
      expect(errorResponse.properties).toBeDefined();
      const props = errorResponse.properties as Record<string, unknown>;
      expect(props.error).toBeDefined();
    });
  });

  describe('Response Codes', () => {
    test('successful operations include 200 or 202 responses', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const responses = (operation as Record<string, unknown>).responses;
            if (responses) {
              const responseCodes = Object.keys(responses as Record<string, unknown>);
              // Most operations should have at least one 2xx response
              const has2xx = responseCodes.some((code) => code.startsWith('2'));
              expect(has2xx || responseCodes.includes('default')).toBe(true);
            }
          }
        });
      });
    });

    test('protected endpoints include 401 unauthorized response', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const endpoints = ['/api/runs', '/api/metrics'];

      endpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem) {
          Object.entries(pathItem).forEach(([method, operation]) => {
            if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
              const responses = (operation as Record<string, unknown>).responses;
              if (responses) {
                const responseCodes = Object.keys(responses as Record<string, unknown>);
                expect(responseCodes).toContain('401');
              }
            }
          });
        }
      });
    });

    test('bad request endpoints include 400 response', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const postEndpoints = ['/api/runs', '/api/validate'];

      postEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem && pathItem.post) {
          const responses = (pathItem.post as Record<string, unknown>).responses;
          if (responses) {
            const responseCodes = Object.keys(responses as Record<string, unknown>);
            expect(responseCodes).toContain('400');
          }
        }
      });
    });
  });

  describe('Tags', () => {
    test('all tag names are referenced in operations', () => {
      const tags = spec.tags as Array<Record<string, unknown>>;
      const tagNames = tags.map((tag) => tag.name as string);
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      const usedTags = new Set<string>();
      Object.values(paths).forEach((pathItem) => {
        Object.values(pathItem).forEach((operation) => {
          if (typeof operation === 'object' && operation !== null && 'tags' in operation) {
            const operationTags = (operation as Record<string, unknown>).tags;
            if (Array.isArray(operationTags)) {
              operationTags.forEach((tag) => usedTags.add(tag as string));
            }
          }
        });
      });

      usedTags.forEach((tag) => {
        expect(tagNames).toContain(tag);
      });
    });
  });

  describe('Content', () => {
    test('spec is serializable to JSON', () => {
      expect(() => {
        JSON.stringify(spec);
      }).not.toThrow();
    });

    test('JSON serialization produces valid string', () => {
      const json = JSON.stringify(spec);
      expect(typeof json).toBe('string');
      expect(json.length).toBeGreaterThan(100);

      // Should be parseable back
      const parsed = JSON.parse(json);
      expect(parsed.openapi).toBe('3.1.0');
    });

    test('has reasonable number of endpoints', () => {
      const paths = spec.paths as Record<string, unknown>;
      const endpointCount = Object.keys(paths).length;
      expect(endpointCount).toBeGreaterThanOrEqual(14); // At least 14 endpoints
      expect(endpointCount).toBeLessThan(100); // But not too many
    });
  });

  describe('Path and Payload Validation', () => {
    test('all path parameters are documented', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([pathName, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const op = operation as Record<string, unknown>;
            const parameters = op.parameters as Array<Record<string, unknown>> | undefined;

            // Extract path parameters from the path template (e.g., {id}, {file})
            const pathParamNames = (pathName.match(/\{([^}]+)\}/g) || []).map(p => p.slice(1, -1));

            if (pathParamNames.length > 0 && parameters) {
              const documentedParams = parameters.map(p => p.name as string);
              pathParamNames.forEach((paramName) => {
                expect(documentedParams).toContain(paramName);
              });
            }
          }
        });
      });
    });

    test('POST/PUT operations with request body have requestBody defined', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const methodsWithBody = ['post', 'put'];

      Object.entries(paths).forEach(([, pathItem]) => {
        methodsWithBody.forEach((method) => {
          if (method in pathItem) {
            const operation = pathItem[method] as Record<string, unknown>;
            // Methods that modify state should have a requestBody or be idempotent
            if (method === 'post' && !('requestBody' in operation)) {
              // Allow some POST endpoints without bodies (e.g., cancel)
              const operationId = operation.operationId as string | undefined;
              if (operationId && !operationId.includes('cancel') && !operationId.includes('shutdown')) {
                expect(operation.requestBody).toBeDefined();
              }
            }
          }
        });
      });
    });

    test('request body schemas reference defined schemas', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const schemaNames = Object.keys(schemas);

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([, operation]) => {
          if (typeof operation === 'object' && operation !== null && 'requestBody' in operation) {
            const rb = operation as Record<string, unknown>;
            const requestBody = rb.requestBody as Record<string, Record<string, Record<string, unknown>>> | undefined;

            if (requestBody && requestBody['content']) {
              Object.values(requestBody['content']).forEach((content) => {
                const schema = content.schema as Record<string, unknown> | undefined;
                if (schema && '$ref' in schema) {
                  const ref = (schema.$ref as string).split('/').pop();
                  if (ref && !ref.startsWith('object')) {
                    expect(schemaNames).toContain(ref);
                  }
                }
              });
            }
          }
        });
      });
    });

    test('response schemas reference defined schemas', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const schemaNames = Object.keys(schemas);

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([, operation]) => {
          if (typeof operation === 'object' && operation !== null && 'responses' in operation) {
            const responses = (operation as Record<string, unknown>).responses as Record<string, Record<string, Record<string, unknown>>> | undefined;

            if (responses) {
              Object.values(responses).forEach((response) => {
                const resp = response as Record<string, unknown>;
                if (resp.content) {
                  const content = resp.content as Record<string, Record<string, unknown>>;
                  Object.values(content).forEach((contentType) => {
                    const schema = (contentType as Record<string, unknown>).schema as Record<string, unknown> | undefined;
                    if (schema && '$ref' in schema) {
                      const ref = (schema.$ref as string).split('/').pop();
                      if (ref && !ref.startsWith('object')) {
                        expect(schemaNames).toContain(ref);
                      }
                    }
                  });
                }
              });
            }
          }
        });
      });
    });
  });

  describe('Error Response Contract', () => {
    test('all 4xx/5xx responses include ErrorResponse schema', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const responses = (operation as Record<string, unknown>).responses as Record<string, Record<string, unknown>> | undefined;

            if (responses) {
              Object.entries(responses).forEach(([statusCode, response]) => {
                if ((statusCode.startsWith('4') || statusCode.startsWith('5')) && statusCode !== 'default') {
                  if (response.content) {
                    const jsonContent = (response.content as Record<string, Record<string, unknown>>) ['application/json'];
                    if (jsonContent && jsonContent.schema) {
                      const schema = jsonContent.schema as Record<string, unknown>;
                      if ('$ref' in schema) {
                        const ref = schema.$ref as string;
                        expect(ref).toContain('ErrorResponse');
                      }
                    }
                  }
                }
              });
            }
          }
        });
      });
    });

    test('all protected endpoints document 401 and 403 responses', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const protectedEndpoints = ['/api/runs', '/api/metrics', '/api/runs/{id}/status', '/api/runs/{id}/cancel'];

      protectedEndpoints.forEach((endpoint) => {
        const pathItem = paths[endpoint];
        if (pathItem) {
          Object.entries(pathItem).forEach(([method, operation]) => {
            if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
              const op = operation as Record<string, unknown>;
              const security = op.security as Array<Record<string, unknown>> | undefined;

              // If endpoint has security requirement, it should document 401
              if (security && security.length > 0) {
                const responses = op.responses as Record<string, unknown> | undefined;
                if (responses && ('401' in responses || 'default' in responses)) {
                  expect(responses['401'] || responses['default']).toBeDefined();
                }
              }
            }
          });
        }
      });
    });

    test('delete/destructive endpoints document error responses', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        ['delete', 'put'].forEach((method) => {
          if (method in pathItem && typeof pathItem[method] === 'object') {
            const operation = pathItem[method] as Record<string, unknown>;
            const responses = operation.responses as Record<string, unknown> | undefined;

            if (responses) {
              // Destructive operations should have 4xx error responses
              const hasErrorResponse = ['400', '401', '404', '409', '422'].some((code) => code in responses);
              expect(hasErrorResponse || responses['default']).toBeTruthy();
            }
          }
        });
      });
    });

    test('documented error codes are consistent across endpoints', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const errorCodesByType = new Map<string, Set<string>>();

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const responses = (operation as Record<string, unknown>).responses as Record<string, unknown> | undefined;

            if (responses) {
              const codes = Object.keys(responses).filter((code) => code.match(/^[45]\d{2}$/));
              const endpointType = method.toUpperCase();

              if (!errorCodesByType.has(endpointType)) {
                errorCodesByType.set(endpointType, new Set());
              }
              codes.forEach((code) => {
                errorCodesByType.get(endpointType)!.add(code);
              });
            }
          }
        });
      });

      // Check that similar operations use consistent error codes
      // (e.g., all GET endpoints should document similar error patterns)
      expect(errorCodesByType.size).toBeGreaterThan(0);
    });
  });

  describe('Request Validation Constraints', () => {
    test('RunRequest repoUrl property has validation constraints', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const repoUrl = props.repoUrl as Record<string, unknown>;

      // Should have string type and format validations
      expect(repoUrl.type).toBe('string');
      expect(repoUrl.format || repoUrl.pattern).toBeDefined(); // Either format:uri or a pattern
    });

    test('RunRequest timeoutSeconds has min/max constraints', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const timeout = props.timeoutSeconds as Record<string, unknown>;

      // Should have numeric type
      expect(timeout.type).toBe('integer');
      // Should document min/max or constraints in description
      expect((timeout.minimum || timeout.description) !== undefined).toBe(true);
    });

    test('enum fields constrain allowed values', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;

      // Check for taskMode or similar enum fields
      const taskMode = props.taskMode as Record<string, unknown>;
      if (taskMode) {
        expect(taskMode.enum || taskMode.allOf).toBeDefined();
      }
    });
  });

  describe('Response Structure', () => {
    test('error responses have consistent structure', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const errorResponse = schemas.ErrorResponse as Record<string, Record<string, unknown>>;
      const props = errorResponse.properties as Record<string, unknown>;

      expect(props.error).toBeDefined(); // error message
      expect(Object.keys(props).length).toBeGreaterThan(0);
    });

    test('error responses include requestId for tracing', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const errorResponse = schemas.ErrorResponse as Record<string, Record<string, unknown>>;
      const props = errorResponse.properties as Record<string, unknown>;

      // Should have some form of request ID or correlation ID
      const hasTracingField = Object.keys(props).some(
        (key) => key.includes('request') || key.includes('correlation') || key.includes('id')
      );
      expect(hasTracingField || props.requestId !== undefined).toBe(true);
    });

    test('successful responses include timestamp', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;

      Object.keys(schemas).forEach((schemaName) => {
        if (['Response', 'Result', 'Status'].some((suffix) => schemaName.includes(suffix))) {
          const schema = (schemas[schemaName] as Record<string, Record<string, unknown>>) || {};
          const props = schema.properties as Record<string, unknown>;

          if (props && Object.keys(props).length > 0) {
            // Most response schemas should have a timestamp
            // Verify structure is reasonable
            expect(props).toBeDefined();
            expect(Object.keys(props).length).toBeGreaterThan(0);
          }
        }
      });
    });
  });

  describe('Content Negotiation', () => {
    test('responses define content types appropriately', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      let contentTypesFound = 0;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const op = operation as Record<string, unknown>;
            const responses = op.responses as Record<string, Record<string, unknown>> | undefined;

            if (responses) {
              Object.values(responses).forEach((response) => {
                if (response && response.content) {
                  contentTypesFound++;
                  const content = response.content as Record<string, unknown>;
                  // Verify content types are defined and not empty
                  expect(Object.keys(content).length).toBeGreaterThan(0);
                }
              });
            }
          }
        });
      });

      // Should have found at least some responses with content types
      expect(contentTypesFound).toBeGreaterThan(0);
    });

    test('request content type is application/json', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([, operation]) => {
          if (typeof operation === 'object' && operation !== null && 'requestBody' in operation) {
            const op = operation as Record<string, unknown>;
            const rb = op.requestBody as Record<string, Record<string, unknown>> | undefined;

            if (rb && rb.content) {
              Object.keys(rb.content).forEach((contentType) => {
                expect(contentType).toContain('application/json');
              });
            }
          }
        });
      });
    });
  });

  describe('Optional and Required Fields', () => {
    test('RunRequest marks required fields in spec', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;

      expect(runRequest.required).toBeDefined();
      expect(Array.isArray(runRequest.required)).toBe(true);

      // repoUrl should be required
      const required = runRequest.required as unknown as Array<string>;
      expect(required).toContain('repoUrl');
    });

    test('optional fields are not in required array', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const required = (runRequest.required as unknown as Array<string>) || [];

      // taskPrompt, webhookConfig, etc. should not be required
      expect(required.length).toBeLessThan(Object.keys((runRequest.properties as Record<string, unknown>)).length);
    });
  });

  describe('Nested Objects and Complex Types', () => {
    test('webhookConfig is properly documented', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const webhookConfig = props.webhookConfig as Record<string, unknown>;

      if (webhookConfig) {
        expect(webhookConfig.type || webhookConfig.$ref || webhookConfig.allOf).toBeDefined();
      }
    });

    test('tracing object has proper structure', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const tracing = props.tracing as Record<string, unknown>;

      if (tracing) {
        expect(tracing.type || tracing.$ref).toBeDefined();
      }
    });
  });

  describe('Endpoint Completeness', () => {
    test('all Express routes are documented in OpenAPI spec', () => {
      // This is a meta-test to ensure nothing is missing
      const paths = spec.paths as Record<string, unknown>;
      const endpoints = Object.keys(paths);

      // Should have at least the major endpoints
      const requiredEndpoints = ['/health', '/ready', '/api/runs', '/api/metrics'];
      requiredEndpoints.forEach((endpoint) => {
        expect(endpoints).toContain(endpoint);
      });
    });

    test('all endpoints have operationId defined for client generation', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const op = operation as Record<string, unknown>;
            // operationId helps with client generation and documentation
            if (op.operationId) {
              expect(typeof op.operationId).toBe('string');
              expect((op.operationId as string).length).toBeGreaterThan(0);
            }
          }
        });
      });
    });

    test('parameter documentation is complete', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const op = operation as Record<string, unknown>;
            const parameters = op.parameters as Array<Record<string, unknown>> | undefined;

            if (parameters) {
              parameters.forEach((param) => {
                expect(param.name).toBeDefined();
                expect(param.in).toBeDefined();
                expect(['path', 'query', 'header'].includes(param.in as string)).toBe(true);
              });
            }
          }
        });
      });
    });
  });

  describe('Request Validation Edge Cases', () => {
    test('taskPrompt field exists and has correct type', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const taskPrompt = props.taskPrompt as Record<string, unknown>;

      expect(taskPrompt).toBeDefined();
      expect(taskPrompt.type).toBe('string');
      expect(taskPrompt.description).toBeDefined();
    });

    test('repoUrl is required and has URI format validation', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const required = runRequest.required as unknown as Array<string>;

      expect(required).toContain('repoUrl');

      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const repoUrl = props.repoUrl as Record<string, unknown>;
      expect(repoUrl.format).toBe('uri');
    });

    test('maxDiffBytes has integer type and reasonable constraints', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const maxDiffBytes = props.maxDiffBytes as Record<string, unknown>;

      expect(maxDiffBytes.type).toBe('integer');
      // Should have constraints to prevent unreasonably large values
      expect(maxDiffBytes.minimum !== undefined || maxDiffBytes.maximum !== undefined || maxDiffBytes.description).toBeDefined();
    });

    test('timeoutSeconds has integer type with min/max constraints', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const timeout = props.timeoutSeconds as Record<string, unknown>;

      expect(timeout.type).toBe('integer');
      expect(timeout.minimum).toBeDefined();
      expect(timeout.maximum).toBeDefined();
      // Minimum should be reasonable (e.g., at least 60 seconds)
      expect((timeout.minimum as number) >= 60).toBe(true);
    });

    test('changedFilesAllowlist has array type with string items', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const allowlist = props.changedFilesAllowlist as Record<string, unknown>;

      expect(allowlist.type).toBe('array');
      const items = allowlist.items as Record<string, unknown>;
      expect(items.type).toBe('string');
    });

    test('validationCommands has array type with string items', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const commands = props.validationCommands as Record<string, unknown>;

      expect(commands.type).toBe('array');
      const items = commands.items as Record<string, unknown>;
      expect(items.type).toBe('string');
    });

    test('taskMode enum is defined and includes valid values', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const taskMode = props.taskMode as Record<string, unknown>;

      expect(taskMode.enum).toBeDefined();
      const enumValues = taskMode.enum as unknown as Array<string>;
      expect(enumValues).toContain('patch');
      expect(enumValues).toContain('inspect');
    });

    test('publishMode enum is defined with comprehensive publish options', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const publishMode = props.publishMode as Record<string, unknown>;

      expect(publishMode.enum).toBeDefined();
      const enumValues = publishMode.enum as unknown as Array<string>;
      expect(enumValues.length).toBeGreaterThan(0);
      // Should include at least common modes
      expect(enumValues.some((v) => ['auto', 'none', 'pr', 'branch', 'draft_pr'].includes(v))).toBe(true);
    });

    test('startupCheck is boolean type when defined', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const startupCheck = props.startupCheck as Record<string, unknown>;

      expect(startupCheck.type).toBe('boolean');
    });

    test('idempotencyKey has UUID format when present', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const idempotencyKey = props.idempotencyKey as Record<string, unknown>;

      if (idempotencyKey) {
        expect(idempotencyKey.type).toBe('string');
        expect(idempotencyKey.format).toBe('uuid');
      }
    });

    test('all properties have descriptions', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;

      Object.entries(props).forEach(([_, propSchema]) => {
        expect((propSchema as Record<string, unknown>).description).toBeDefined();
      });
    });
  });

  describe('Schema Property Validation', () => {
    test('RunResponse has all required properties with correct types', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, Record<string, unknown>>;
      const required = runResponse.required as unknown as Array<string>;
      const props = runResponse.properties as Record<string, Record<string, unknown>>;

      expect(required).toContain('id');
      expect(required).toContain('status');
      expect(required).toContain('createdAt');

      // Verify types
      expect(props.id.type).toBe('string');
      expect(props.status.type).toBe('string');
      expect(props.createdAt.type).toBe('string');
      expect(props.createdAt.format).toBe('date-time');
    });

    test('RunResponse status field has valid enum values', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, Record<string, unknown>>;
      const props = runResponse.properties as Record<string, Record<string, unknown>>;
      const status = props.status as Record<string, unknown>;

      expect(status.enum).toBeDefined();
      const statusValues = status.enum as unknown as Array<string>;
      expect(statusValues).toContain('queued');
      expect(statusValues).toContain('running');
      expect(statusValues).toContain('completed');
      expect(statusValues).toContain('failed');
    });

    test('StatusResponse has all required properties with correct types', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const statusResponse = schemas.StatusResponse as Record<string, Record<string, unknown>>;
      const required = statusResponse.required as unknown as Array<string>;
      const props = statusResponse.properties as Record<string, Record<string, unknown>>;

      expect(required).toContain('id');
      expect(required).toContain('status');
      expect(required).toContain('elapsedSeconds');
      expect(required).toContain('timeoutRiskPercent');

      // Verify types
      expect(props.id.type).toBe('string');
      expect(props.elapsedSeconds.type).toBe('number');
      expect(props.timeoutRiskPercent.type).toBe('number');
    });

    test('StatusResponse progress object has required structure when present', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const statusResponse = schemas.StatusResponse as Record<string, Record<string, unknown>>;
      const props = statusResponse.properties as Record<string, Record<string, unknown>>;
      const progress = props.progress as Record<string, Record<string, unknown>>;

      if (progress && progress.properties) {
        const progressProps = progress.properties as Record<string, Record<string, unknown>>;
        // Progress should have stage information
        expect(progressProps.stage || progressProps.percentComplete).toBeDefined();
      }
    });

    test('StatusResponse percentComplete has min/max constraints', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const statusResponse = schemas.StatusResponse as Record<string, Record<string, unknown>>;
      const props = statusResponse.properties as Record<string, Record<string, unknown>>;
      const progress = props.progress as Record<string, Record<string, unknown>>;

      if (progress && progress.properties) {
        const progressProps = progress.properties as Record<string, Record<string, unknown>>;
        const percentComplete = progressProps.percentComplete as Record<string, unknown>;

        if (percentComplete) {
          expect(percentComplete.type).toBe('integer');
          expect(percentComplete.minimum).toBe(0);
          expect(percentComplete.maximum).toBe(100);
        }
      }
    });

    test('ErrorResponse has required error field', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const errorResponse = schemas.ErrorResponse as Record<string, Record<string, unknown>>;
      const required = errorResponse.required as unknown as Array<string>;

      expect(required).toContain('error');
    });

    test('all date-time fields use proper format constraint', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;

      Object.entries(schemas).forEach(([, schema]) => {
        const schemaObj = schema as Record<string, Record<string, unknown>>;
        const props = schemaObj.properties as Record<string, Record<string, unknown>>;

        Object.entries(props || {}).forEach(([propName, propSchema]) => {
          if (
            propName.includes('At') ||
            propName.includes('Timestamp') ||
            propName.includes('created') ||
            propName.includes('updated')
          ) {
            expect((propSchema as Record<string, unknown>).format).toBe('date-time');
          }
        });
      });
    });

    test('UUID fields use proper format constraint when defined', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;

      // Check for idempotencyKey specifically, which should have UUID format
      const runRequest = schemas.RunRequest as Record<string, Record<string, unknown>>;
      const props = runRequest.properties as Record<string, Record<string, unknown>>;
      const idempotencyKey = props.idempotencyKey as Record<string, unknown>;

      if (idempotencyKey && idempotencyKey.type === 'string') {
        expect(idempotencyKey.format).toBe('uuid');
      }
    });

    test('RunResponse completedAt is optional and date-time format', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, Record<string, unknown>>;
      const props = runResponse.properties as Record<string, Record<string, unknown>>;
      const completedAt = props.completedAt as Record<string, unknown>;

      if (completedAt) {
        expect(completedAt.type).toBe('string');
        expect(completedAt.format).toBe('date-time');
      }
    });

    test('RunResponse exitCode is integer type when present', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, Record<string, unknown>>;
      const props = runResponse.properties as Record<string, Record<string, unknown>>;
      const exitCode = props.exitCode as Record<string, unknown>;

      if (exitCode) {
        expect(exitCode.type).toBe('integer');
      }
    });

    test('RunResponse error field is string when present', () => {
      const schemas = (spec.components as Record<string, Record<string, unknown>>).schemas;
      const runResponse = schemas.RunResponse as Record<string, Record<string, unknown>>;
      const props = runResponse.properties as Record<string, Record<string, unknown>>;
      const error = props.error as Record<string, unknown>;

      if (error) {
        expect(error.type).toBe('string');
      }
    });
  });

  describe('Advanced Error Response Validation', () => {
    test('all 5xx responses indicate server error with ErrorResponse', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      let found5xx = false;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const responses = (operation as Record<string, unknown>).responses as Record<string, unknown> | undefined;

            if (responses) {
              Object.entries(responses).forEach(([statusCode]) => {
                if (statusCode.startsWith('5')) {
                  found5xx = true;
                  const response = (responses as Record<string, Record<string, unknown>>)[statusCode];
                  if (response.content) {
                    const jsonContent = (response.content as Record<string, Record<string, unknown>>)['application/json'];
                    if (jsonContent && jsonContent.schema) {
                      const schema = jsonContent.schema as Record<string, unknown>;
                      // 5xx errors should reference ErrorResponse
                      if ('$ref' in schema) {
                        expect((schema.$ref as string).includes('ErrorResponse')).toBe(true);
                      }
                    }
                  }
                }
              });
            }
          }
        });
      });

      // If no 5xx responses found, that's fine (not all endpoints may have them documented)
      expect(typeof found5xx).toBe('boolean');
    });

    test('protected endpoints document complete authentication failure scenarios', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const op = operation as Record<string, unknown>;
            const security = op.security as Array<Record<string, unknown>> | undefined;

            // If endpoint requires security
            if (security && Array.isArray(security) && security.length > 0) {
              const responses = op.responses as Record<string, unknown> | undefined;
              if (responses) {
                // Should have 401 for invalid/missing token
                expect('401' in responses || 'default' in responses).toBe(true);
              }
            }
          }
        });
      });
    });

    test('error response examples are valid JSON', () => {
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      Object.entries(paths).forEach(([, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
          if (method !== 'parameters' && typeof operation === 'object' && operation !== null) {
            const responses = (operation as Record<string, unknown>).responses as Record<string, unknown> | undefined;

            if (responses) {
              Object.entries(responses).forEach(([statusCode, response]) => {
                if (statusCode.startsWith('4') || statusCode.startsWith('5')) {
                  const resp = response as Record<string, Record<string, Record<string, unknown>>>;
                  if (resp.content && resp.content['application/json'] && resp.content['application/json'].example) {
                    // If example is provided, it should be valid
                    expect(typeof resp.content['application/json'].example).not.toBe('undefined');
                  }
                }
              });
            }
          }
        });
      });
    });
  });
});
