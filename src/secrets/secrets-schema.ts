/**
 * Secret Format Validators
 *
 * Provides schema validation for different secret types.
 * Used primarily by setup-time flows to validate credential format before storage.
 *
 * Note: Runtime secret retrieval does NOT validate format — only basic existence checks.
 * Validation is optional and used by SetupWizard and SecretsCommand (list) operations.
 */

/**
 * Schema definition for a secret type
 */
interface SecretSchema {
  name: string;
  pattern: RegExp | null;
  validate(value: string): { valid: boolean; error?: string };
}

/**
 * Registered secret schemas
 */
const schemas: Record<string, SecretSchema> = {
  openrouter_api_key: {
    name: 'OpenRouter API Key',
    pattern: /^sk-or-[a-zA-Z0-9]+$/,
    validate(value: string) {
      if (!/^sk-or-/.test(value)) {
        return { valid: false, error: 'Must start with "sk-or-"' };
      }
      if (value.length < 20) {
        return { valid: false, error: 'Looks incomplete (too short)' };
      }
      return { valid: true };
    },
  },
  github_app_private_key: {
    name: 'GitHub App Private Key',
    pattern: null,
    validate(value: string) {
      if (!value.includes('BEGIN RSA PRIVATE KEY')) {
        return { valid: false, error: 'Not a valid RSA private key (missing header)' };
      }
      if (!value.includes('END RSA PRIVATE KEY')) {
        return { valid: false, error: 'Not a valid RSA private key (missing footer)' };
      }
      return { valid: true };
    },
  },
  kaseki_api_keys: {
    name: 'Kaseki API Keys',
    pattern: /^[a-f0-9:;-]+$/,
    validate(value: string) {
      // Comma or semicolon-separated UUIDs
      const keys = value.split(/[,;]/).map((k) => k.trim());
      for (const key of keys) {
        if (!/^[a-f0-9-]+$/.test(key)) {
          return { valid: false, error: 'Contains invalid UUID format' };
        }
      }
      return { valid: true };
    },
  },
};

/**
 * Validate secret format and return detailed error if invalid
 * @param secretName - The secret identifier (e.g., 'openrouter_api_key')
 * @param value - The secret value to validate
 * @returns Validation result with optional error message
 */
export function validateSecretFormat(secretName: string, value: string): { valid: boolean; error?: string } {
  const schema = schemas[secretName];
  if (!schema) {
    // Unknown secret type; assume valid
    return { valid: true };
  }

  if (!value || value.trim().length === 0) {
    return { valid: false, error: `${schema.name} cannot be empty` };
  }

  return schema.validate(value);
}
