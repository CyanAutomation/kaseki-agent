/**
 * Scouting prompt context tests
 */

import {
  buildBuildContext,
  buildAsyncContext,
  buildScoutingPromptContext,
  embedScoutingContextInTaskPrompt,
  summarizeScoutingDiscoveries,
} from './scouting-prompt-context';
import type { BuildCapabilityInfo } from '../build-capability-detector';
import type { AsyncImpactAnalysis } from '../scouting/async-impact-analyzer';

describe('scouting-prompt-context', () => {
  const mockBuildCapability: BuildCapabilityInfo = {
    language: 'typescript',
    command: 'npm run build',
    detected: true,
    detectedAt: Date.now(),
  };

  const mockAsyncImpact: AsyncImpactAnalysis = {
    hasAsyncChanges: true,
    asyncKeywords: ['async', 'await'],
    mockFiles: ['src/__mocks__/api.ts', 'src/mocks/http.ts'],
    testFiles: ['src/api.test.ts', 'src/http.test.ts', 'src/client.test.ts'],
    interfaceFiles: ['src/types/api.interface.ts'],
    consumerFiles: ['src/services/userService.ts'],
    summary: 'Async changes: 2 mocks, 3 tests, 1 interface affected',
  };

  describe('buildBuildContext', () => {
    it('should generate build context when build detected', () => {
      const context = buildBuildContext(mockBuildCapability);

      expect(context).toBeTruthy();
      expect(context).toContain('Build System');
      expect(context).toContain('typescript');
      expect(context).toContain('npm run build');
      expect(context).toContain('validated');
    });

    it('should return empty string when no build detected', () => {
      const noBuild: BuildCapabilityInfo = {
        language: null,
        command: null,
        detected: false,
        detectedAt: Date.now(),
      };

      const context = buildBuildContext(noBuild);
      expect(context).toBe('');
    });

    it('should return empty string when null', () => {
      const context = buildBuildContext(null);
      expect(context).toBe('');
    });

    it('should mention compilation success requirement', () => {
      const context = buildBuildContext(mockBuildCapability);
      expect(context.toLowerCase()).toContain('compil');
    });

    it('should format command as code', () => {
      const context = buildBuildContext(mockBuildCapability);
      expect(context).toContain('`npm run build`');
    });
  });

  describe('buildAsyncContext', () => {
    it('should generate async context when async changes detected', () => {
      const context = buildAsyncContext(mockAsyncImpact);

      expect(context).toBeTruthy();
      expect(context).toContain('Async Changes');
      expect(context).toContain('async');
      expect(context).toContain('await');
    });

    it('should list mock files when present', () => {
      const context = buildAsyncContext(mockAsyncImpact);

      expect(context).toContain('Mock Files to Update');
      expect(context).toContain('__mocks__/api.ts');
    });

    it('should list test files when present', () => {
      const context = buildAsyncContext(mockAsyncImpact);

      expect(context).toContain('Test Files to Update');
      expect(context).toContain('api.test.ts');
      expect(context).toContain('async/await');
    });

    it('should list interface files when present', () => {
      const context = buildAsyncContext(mockAsyncImpact);

      expect(context).toContain('Interface Files');
      expect(context).toContain('api.interface.ts');
    });

    it('should mention consumer files', () => {
      const context = buildAsyncContext(mockAsyncImpact);

      expect(context).toContain('Consumer Files');
      expect(context).toContain('userService.ts');
    });

    it('should indicate more files when exceeding limit', () => {
      const manyMocks: AsyncImpactAnalysis = {
        ...mockAsyncImpact,
        mockFiles: Array.from({ length: 10 }, (_, i) => `mock-${i}.ts`),
      };

      const context = buildAsyncContext(manyMocks);

      expect(context).toContain('and 5 more');
    });

    it('should return empty string when no async changes', () => {
      const noAsync: AsyncImpactAnalysis = {
        hasAsyncChanges: false,
        asyncKeywords: [],
        mockFiles: [],
        testFiles: [],
        interfaceFiles: [],
        consumerFiles: [],
        summary: '',
      };

      const context = buildAsyncContext(noAsync);
      expect(context).toBe('');
    });

    it('should return empty string when null', () => {
      const context = buildAsyncContext(null);
      expect(context).toBe('');
    });
  });

  describe('buildScoutingPromptContext', () => {
    it('should build complete context with both build and async', () => {
      const context = buildScoutingPromptContext(mockBuildCapability, mockAsyncImpact);

      expect(context.buildContext).toBeTruthy();
      expect(context.asyncContext).toBeTruthy();
      expect(context.combinedContext).toBeTruthy();
      expect(context.hasBuildInfo).toBe(true);
      expect(context.hasAsyncInfo).toBe(true);
    });

    it('should include section header', () => {
      const context = buildScoutingPromptContext(mockBuildCapability, mockAsyncImpact);

      expect(context.combinedContext).toContain('Validation Context');
    });

    it('should return empty combined when nothing detected', () => {
      const noBuild: BuildCapabilityInfo = {
        language: null,
        command: null,
        detected: false,
        detectedAt: Date.now(),
      };
      const noAsync: AsyncImpactAnalysis = {
        hasAsyncChanges: false,
        asyncKeywords: [],
        mockFiles: [],
        testFiles: [],
        interfaceFiles: [],
        consumerFiles: [],
        summary: '',
      };

      const context = buildScoutingPromptContext(noBuild, noAsync);

      expect(context.combinedContext).toBe('');
      expect(context.hasBuildInfo).toBe(false);
      expect(context.hasAsyncInfo).toBe(false);
    });

    it('should only include build when async not detected', () => {
      const noAsync: AsyncImpactAnalysis = {
        hasAsyncChanges: false,
        asyncKeywords: [],
        mockFiles: [],
        testFiles: [],
        interfaceFiles: [],
        consumerFiles: [],
        summary: '',
      };

      const context = buildScoutingPromptContext(mockBuildCapability, noAsync);

      expect(context.buildContext).toBeTruthy();
      expect(context.asyncContext).toBe('');
      expect(context.hasBuildInfo).toBe(true);
      expect(context.hasAsyncInfo).toBe(false);
    });
  });

  describe('embedScoutingContextInTaskPrompt', () => {
    it('should prepend context to original prompt', () => {
      const originalPrompt = 'Fix the parser logic';
      const enhanced = embedScoutingContextInTaskPrompt(
        originalPrompt,
        mockBuildCapability,
        mockAsyncImpact,
      );

      expect(enhanced).toContain('Build System');
      expect(enhanced).toContain('Async Changes');
      expect(enhanced).toContain('Fix the parser logic');
      expect(enhanced.indexOf('Build System')).toBeLessThan(enhanced.indexOf('Fix the parser'));
    });

    it('should include separator', () => {
      const originalPrompt = 'Fix the parser logic';
      const enhanced = embedScoutingContextInTaskPrompt(
        originalPrompt,
        mockBuildCapability,
        mockAsyncImpact,
      );

      expect(enhanced).toContain('---');
    });

    it('should return original when no context detected', () => {
      const originalPrompt = 'Fix the parser logic';
      const noBuild: BuildCapabilityInfo = {
        language: null,
        command: null,
        detected: false,
        detectedAt: Date.now(),
      };
      const noAsync: AsyncImpactAnalysis = {
        hasAsyncChanges: false,
        asyncKeywords: [],
        mockFiles: [],
        testFiles: [],
        interfaceFiles: [],
        consumerFiles: [],
        summary: '',
      };

      const enhanced = embedScoutingContextInTaskPrompt(originalPrompt, noBuild, noAsync);

      expect(enhanced).toBe(originalPrompt);
    });

    it('should preserve original prompt formatting', () => {
      const originalPrompt = `Fix the parser logic.
        - Handle edge cases
        - Update tests`;

      const enhanced = embedScoutingContextInTaskPrompt(
        originalPrompt,
        mockBuildCapability,
        null,
      );

      expect(enhanced).toContain(originalPrompt);
    });
  });

  describe('summarizeScoutingDiscoveries', () => {
    it('should summarize build discovery', () => {
      const summary = summarizeScoutingDiscoveries(mockBuildCapability, null);

      expect(summary).toContain('Build');
      expect(summary).toContain('typescript');
    });

    it('should summarize async discovery', () => {
      const summary = summarizeScoutingDiscoveries(null, mockAsyncImpact);

      expect(summary).toContain('Async');
      expect(summary).toContain('2 mocks');
      expect(summary).toContain('3 tests');
    });

    it('should combine both discoveries', () => {
      const summary = summarizeScoutingDiscoveries(mockBuildCapability, mockAsyncImpact);

      expect(summary).toContain('Build');
      expect(summary).toContain('Async');
      expect(summary).toContain('|');
    });

    it('should return default message when nothing detected', () => {
      const noBuild: BuildCapabilityInfo = {
        language: null,
        command: null,
        detected: false,
        detectedAt: Date.now(),
      };
      const noAsync: AsyncImpactAnalysis = {
        hasAsyncChanges: false,
        asyncKeywords: [],
        mockFiles: [],
        testFiles: [],
        interfaceFiles: [],
        consumerFiles: [],
        summary: '',
      };

      const summary = summarizeScoutingDiscoveries(noBuild, noAsync);

      expect(summary).toContain('No scouting');
    });
  });

  describe('formatting', () => {
    it('should use markdown formatting', () => {
      const context = buildScoutingPromptContext(mockBuildCapability, mockAsyncImpact);

      expect(context.combinedContext).toContain('##');
      expect(context.combinedContext).toContain('**');
      expect(context.combinedContext).toContain('`');
    });

    it('should use emoji for visual clarity', () => {
      const buildContext = buildBuildContext(mockBuildCapability);
      const asyncContext = buildAsyncContext(mockAsyncImpact);

      expect(buildContext).toMatch(/[🔧]/u);
      expect(asyncContext).toMatch(/⚠️/);
    });

    it('should separate sections clearly', () => {
      const context = buildScoutingPromptContext(mockBuildCapability, mockAsyncImpact);

      expect(context.combinedContext).toContain('\n\n');
    });
  });

  describe('edge cases', () => {
    it('should handle very long file list', () => {
      const manyFiles: AsyncImpactAnalysis = {
        ...mockAsyncImpact,
        testFiles: Array.from({ length: 50 }, (_, i) => `test-${i}.ts`),
      };

      const context = buildAsyncContext(manyFiles);

      // Should limit display (only show first 5 files)
      const backtickCount = (context.match(/`/g) || []).length;
      expect(backtickCount).toBeLessThan(20);
    });

    it('should handle empty keyword list', () => {
      const noKeywords: AsyncImpactAnalysis = {
        ...mockAsyncImpact,
        asyncKeywords: [],
      };

      const context = buildAsyncContext(noKeywords);

      // Should still return empty
      expect(context).toBe('');
    });

    it('should handle special characters in file names', () => {
      const specialFiles: AsyncImpactAnalysis = {
        ...mockAsyncImpact,
        mockFiles: ['src/__mocks__/my-api.mock.ts', 'src/[test]-fixture.ts'],
      };

      const context = buildAsyncContext(specialFiles);

      expect(context).toContain('__mocks__');
      expect(context).toContain('-');
    });
  });
});
