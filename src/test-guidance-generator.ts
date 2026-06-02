/**
 * Test Guidance Generator
 * Generates concrete example test modification patterns based on code change areas.
 * Provides before/after code snippets for common test assertion patterns.
 */

export interface TestExample {
  type: 'added_assertion' | 'modified_assertion' | 'added_test_case' | 'added_pattern';
  pattern: string;
  description: string;
  before: string;
  after: string;
}

export interface TestGuidance {
  test_file: string;
  change_reason: string;
  change_type: 'parser' | 'event' | 'response_construction' | 'serializer' | 'naming_convention' | 'unknown';
  affected_assertions: string[];
  test_examples: TestExample[];
  recommended_pattern: string;
  expected_test_count: string;
}

/**
 * Generate test guidance examples based on the type of code change.
 * @param testFile - Path to the test file (e.g., tests/parser.test.ts)
 * @param changeReason - Reason for code change (e.g., "null/empty role handling")
 * @param changeType - Type of change detected
 * @returns TestGuidance with concrete examples
 */
export function generateTestGuidance(
  testFile: string,
  changeReason: string,
  changeType: 'parser' | 'event' | 'response_construction' | 'serializer' | 'naming_convention' | 'unknown' = 'unknown'
): TestGuidance {
  let examples: TestExample[] = [];
  let affectedAssertions: string[] = [];
  let recommendedPattern = '';
  let expectedTestCount = '';

  if (changeType === 'parser') {
    examples = generateParserExamples(changeReason);
    affectedAssertions = ['Input validation', 'Output format', 'Error handling', 'Edge cases (null, empty, undefined)'];
    recommendedPattern = 'Table-driven test cases with specific input/output pairs';
    expectedTestCount = '3-5 test cases per behavior change';
  } else if (changeType === 'event') {
    examples = generateEventExamples(changeReason);
    affectedAssertions = ['Event field presence', 'Event timing/order', 'Event payload structure', 'Event listener coverage'];
    recommendedPattern = 'Event emission and handler validation with async assertions';
    expectedTestCount = '2-4 event-related test cases';
  } else if (changeType === 'response_construction') {
    examples = generateResponseExamples(changeReason);
    affectedAssertions = ['Response serialization', 'Field mapping', 'Type coercion', 'Backward compatibility'];
    recommendedPattern = 'Round-trip serialization/deserialization validation';
    expectedTestCount = '3-5 response validation test cases';
  } else if (changeType === 'serializer') {
    examples = generateSerializerExamples(changeReason);
    affectedAssertions = ['Encoding/decoding', 'Type preservation', 'Special character handling', 'Format compliance'];
    recommendedPattern = 'Encode/decode round-trip with type assertions';
    expectedTestCount = '4-6 serialization test cases';
  } else if (changeType === 'naming_convention') {
    examples = generateNamingExamples(changeReason);
    affectedAssertions = ['Field name assertions', 'Constant value matches', 'API contract adherence', 'String literal matches'];
    recommendedPattern = 'String literal and constant value assertions';
    expectedTestCount = '2-3 naming convention test cases';
  }

  return {
    test_file: testFile,
    change_reason: changeReason,
    change_type: changeType,
    affected_assertions: affectedAssertions,
    test_examples: examples,
    recommended_pattern: recommendedPattern,
    expected_test_count: expectedTestCount,
  };
}

/**
 * Generate parser-related test examples (null handling, input validation, edge cases)
 */
function generateParserExamples(_reason: string): TestExample[] {
  return [
    {
      type: 'added_assertion',
      pattern: 'Null-coalescing assertion',
      description: 'Verify null/undefined input handling with fallback value',
      before: `expect(parseRole(null)).toThrow()`,
      after: `expect(parseRole(null)).toEqual({ name: 'Unnamed Role' }); // per updated spec`,
    },
    {
      type: 'added_assertion',
      pattern: 'Empty string validation',
      description: 'Verify empty string is handled correctly',
      before: `// Test was missing for empty string case`,
      after: `expect(parseRole('')).toEqual({ name: 'Unnamed Role' });`,
    },
    {
      type: 'added_test_case',
      pattern: 'Type coercion test',
      description: 'Verify non-string inputs are coerced or rejected appropriately',
      before: `// Missing: test({ name: 123 })`,
      after: `expect(() => parseRole({ name: 123 })).toThrow(TypeError);`,
    },
    {
      type: 'modified_assertion',
      pattern: 'Whitespace-only input',
      description: 'Update expected behavior for whitespace-only strings',
      before: `expect(parseRole('   ')).toEqual({ name: '   ' })`,
      after: `expect(parseRole('   ')).toEqual({ name: 'Unnamed Role' }); // per trim logic`,
    },
  ];
}

/**
 * Generate event-related test examples (field changes, timing, payload structure)
 */
function generateEventExamples(_reason: string): TestExample[] {
  return [
    {
      type: 'added_assertion',
      pattern: 'Event field presence',
      description: 'Verify new or renamed event field is present',
      before: `// Old: expect(event.originalField).toBeDefined()`,
      after: `expect(event).toHaveProperty('newFieldName'); expect(event.newFieldName).toBeDefined();`,
    },
    {
      type: 'modified_assertion',
      pattern: 'Event timing expectation',
      description: 'Update async timing expectation if event emission timing changed',
      before: `await expect(eventPromise).resolves.toEqual(event); // within 10ms`,
      after: `await expect(eventPromise).resolves.toEqual(event); // within 50ms (async now)`,
    },
    {
      type: 'added_test_case',
      pattern: 'Event listener callback',
      description: 'Add test verifying listener receives updated event structure',
      before: `// Test was missing for listener behavior`,
      after: `const listener = vi.fn(); emitter.on('change', listener); emitter.emit('change', { id: 1, newField: 'value' }); expect(listener).toHaveBeenCalledWith(expect.objectContaining({ newField: 'value' }));`,
    },
    {
      type: 'modified_assertion',
      pattern: 'Event field ordering',
      description: 'Verify event payload field ordering matches spec (if order matters)',
      before: `expect(event).toMatchObject({ a, b, c })`,
      after: `const keys = Object.keys(event); expect(keys).toEqual(['timestamp', 'id', 'payload']); // per new order`,
    },
  ];
}

/**
 * Generate response construction test examples (serialization, field mapping, format)
 */
function generateResponseExamples(_reason: string): TestExample[] {
  return [
    {
      type: 'added_test_case',
      pattern: 'Round-trip serialization',
      description: 'Verify serialization and deserialization preserve data',
      before: `// Missing: serialization round-trip test`,
      after: `const original = { id: 1, data: { nested: 'value' } }; const serialized = serialize(original); const deserialized = deserialize(serialized); expect(deserialized).toEqual(original);`,
    },
    {
      type: 'modified_assertion',
      pattern: 'Field mapping validation',
      description: 'Update assertion if response field names or structure changed',
      before: `expect(response).toHaveProperty('user_id')`,
      after: `expect(response).toHaveProperty('userId'); // per camelCase migration`,
    },
    {
      type: 'added_assertion',
      pattern: 'Type coercion in response',
      description: 'Verify numbers are correctly coerced in serialized format',
      before: `expect(response.count).toBe(5)`,
      after: `expect(response.count).toBe(5); expect(typeof response.count).toBe('number'); // verify no string coercion`,
    },
    {
      type: 'added_test_case',
      pattern: 'Backward compatibility',
      description: 'Test that old format can still be deserialized',
      before: `// Missing: legacy format compatibility test`,
      after: `const legacyData = { user_id: 1 }; const modern = mapLegacyResponse(legacyData); expect(modern).toEqual({ userId: 1 });`,
    },
  ];
}

/**
 * Generate serializer-related test examples (encoding, type preservation, format)
 */
function generateSerializerExamples(_reason: string): TestExample[] {
  return [
    {
      type: 'added_test_case',
      pattern: 'Encode/decode round-trip',
      description: 'Verify data survives encode then decode without loss',
      before: `// Missing: comprehensive round-trip test`,
      after: `const data = { num: 42, str: 'hello', nested: { bool: true } }; const encoded = serialize(data); const decoded = deserialize(encoded); expect(decoded).toEqual(data);`,
    },
    {
      type: 'added_assertion',
      pattern: 'Special character handling',
      description: 'Verify special characters are preserved through serialization',
      before: `expect(serialize('hello')).toBe('"hello"')`,
      after: `const special = 'hello\\nworld\\t\\"quotes\\"'; const encoded = serialize(special); const decoded = deserialize(encoded); expect(decoded).toBe(special);`,
    },
    {
      type: 'modified_assertion',
      pattern: 'Type preservation',
      description: 'Update assertion if type system changed (e.g., BigInt handling)',
      before: `expect(serialize(9007199254740992)).toBe('9007199254740992')`,
      after: `expect(serialize(BigInt('9007199254740992'))).toBe('"9007199254740992n"'); // new format`,
    },
    {
      type: 'added_test_case',
      pattern: 'Format compliance',
      description: 'Verify serialized format matches external spec (JSON, MessagePack, etc.)',
      before: `// Missing: format validation`,
      after: `const encoded = serialize(data); const isValidJSON = (() => { try { JSON.parse(encoded); return true; } catch { return false; } })(); expect(isValidJSON).toBe(true);`,
    },
  ];
}

/**
 * Generate naming convention test examples (renamed fields, constants, etc.)
 */
function generateNamingExamples(_reason: string): TestExample[] {
  return [
    {
      type: 'modified_assertion',
      pattern: 'Field name assertion',
      description: 'Update field name literal in assertion',
      before: `expect(obj).toHaveProperty('user_name')`,
      after: `expect(obj).toHaveProperty('userName'); // per naming convention migration`,
    },
    {
      type: 'modified_assertion',
      pattern: 'Constant value match',
      description: 'Update constant value that may have been renamed',
      before: `expect(status).toBe('USER_INACTIVE')`,
      after: `expect(status).toBe('INACTIVE'); // per simplified naming`,
    },
    {
      type: 'added_assertion',
      pattern: 'API contract check',
      description: 'Verify renamed function/method is properly exposed',
      before: `expect(typeof obj.oldMethodName).toBe('function')`,
      after: `expect(typeof obj.newMethodName).toBe('function'); expect(obj.oldMethodName).toBeUndefined(); // deprecated`,
    },
    {
      type: 'added_test_case',
      pattern: 'Deprecation handling',
      description: 'Add test for deprecated name with migration path',
      before: `// Missing: deprecation test`,
      after: `expect(() => obj.legacyName()).toThrow('Use newName() instead'); // or returns migrated value`,
    },
  ];
}
