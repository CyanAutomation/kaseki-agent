import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './',
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/scripts/**/*.test.ts',
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/tests/**/*.test.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  maxWorkers: process.env.CI ? '50%' : '50%',
  collectCoverageFrom: [
    'src/**/*.ts',
    'scripts/**/*.ts',
    '!src/**/*.test.ts',
    '!scripts/**/*.test.ts',
    '!src/**/index.ts',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        isolatedModules: true,
        esModuleInterop: true,
        module: 'esnext',
        target: 'ES2024',
        lib: ['ES2024'],
        downlevelIteration: true,
      },
    }],
  },
  transformIgnorePatterns: ['node_modules/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 10000,
  // Force Jest to exit if there are open handles
  // This is a last resort - the real fix is proper cleanup in tests
  forceExit: true,
  // Detect and report open handles
  detectOpenHandles: process.env.JEST_DETECT_HANDLES === '1',
};

export default config;
