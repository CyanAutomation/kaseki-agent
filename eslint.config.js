import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';

const ignorePatterns = [
  'node_modules/',
  '.git/',
  '.github/',
  'docker/',
  '/kaseki-runs/',
  '/kaseki-results/',
  '/kaseki-cache/',
  'dist/',
  '**/*.log',
  '.DS_Store',
  '.tmp'
];

const nodeGlobals = {
  global: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  __filename: 'readonly',
  __dirname: 'readonly',
  // CommonJS/dynamic requires
  require: 'readonly',
  module: 'readonly',
  exports: 'readonly',
  // Node.js timers and async
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  // Fetch API and URLs
  fetch: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  // Node.js crypto
  crypto: 'readonly',
  // Node.js performance
  performance: 'readonly'
};

const jestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
  jest: 'readonly'
};

// Base rules shared across JS, TS, and test configs
const baseRules = {
  'indent': ['warn', 2],
  'linebreak-style': ['error', 'unix'],
  'quotes': ['warn', 'single', { avoidEscape: true }],
  'semi': ['warn', 'always'],
  'no-trailing-spaces': 'warn',
  'no-multiple-empty-lines': ['warn', { max: 1 }],
  'no-console': 'off',
  'no-process-exit': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }]
};

// TypeScript-specific unused-imports rules (shared across TS configs)
const tsUnusedImportsRules = {
  'unused-imports/no-unused-imports': 'warn',
  'unused-imports/no-unused-vars': [
    'warn',
    {
      vars: 'all',
      varsIgnorePattern: '^_',
      args: 'after-used',
      argsIgnorePattern: '^_'
    }
  ]
};

export default [
  {
    ignores: ignorePatterns
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules: {
      ...js.configs.recommended.rules,
      ...baseRules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  // Test files - must come before generic TypeScript config
  {
    files: ['src/**/*.test.ts', 'src/__test-utils/**/*.ts', 'src/test-utils.ts', 'perf/**/*.test.ts', 'test/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      globals: {
        ...nodeGlobals,
        ...jestGlobals,
        NodeJS: 'readonly',
        // Browser globals for jsdom environment
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        MouseEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        Element: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImportsPlugin
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...baseRules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      ...tsUnusedImportsRules,
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  // Generic TypeScript files - will not match test files due to being after test config
  {
    files: ['src/**/*.ts', 'perf/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      globals: {
        ...nodeGlobals,
        NodeJS: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImportsPlugin
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...baseRules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      ...tsUnusedImportsRules,
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];
