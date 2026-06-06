/**
 * Artifact Utilities - Test Suite
 *
 * Validates artifact type classification and filtering utilities.
 * Tests whether artifacts are correctly identified as text vs. binary,
 * and filtering operations work correctly.
 */

import { ARTIFACT_METADATA_REGISTRY } from '../src/artifact-metadata';
import { isTextArtifact, filterTextArtifacts, shouldDisplayInline } from '../src/lib/artifact-utilities';

describe('Artifact Utilities', () => {
  describe('isTextArtifact', () => {
    it('should identify JSON artifacts as text', () => {
      expect(isTextArtifact('application/json')).toBe(true);
      expect(isTextArtifact('metadata.json')).toBe(true);
    });

    it('should identify markdown artifacts as text', () => {
      expect(isTextArtifact('text/markdown')).toBe(true);
      expect(isTextArtifact('result-summary.md')).toBe(true);
    });

    it('should identify plain text artifacts as text', () => {
      expect(isTextArtifact('text/plain')).toBe(true);
      expect(isTextArtifact('stderr.log')).toBe(true);
      expect(isTextArtifact('stdout.log')).toBe(true);
    });

    it('should identify JSONL (newline-delimited JSON) as text', () => {
      expect(isTextArtifact('application/x-jsonl')).toBe(true);
      expect(isTextArtifact('pi-events.jsonl')).toBe(true);
    });

    it('should identify TSV (tab-separated values) as text', () => {
      expect(isTextArtifact('text/tab-separated-values')).toBe(true);
      expect(isTextArtifact('validation-timings.tsv')).toBe(true);
    });

    it('should reject binary artifacts (zip)', () => {
      expect(isTextArtifact('application/zip')).toBe(false);
      expect(isTextArtifact('archive.zip')).toBe(false);
    });

    it('should reject binary artifacts (gzip)', () => {
      expect(isTextArtifact('application/gzip')).toBe(false);
      expect(isTextArtifact('archive.gz')).toBe(false);
    });

    it('should reject binary artifacts (tar)', () => {
      expect(isTextArtifact('application/x-tar')).toBe(false);
      expect(isTextArtifact('archive.tar')).toBe(false);
    });

    it('should reject SBOM (CycloneDX) artifacts', () => {
      expect(isTextArtifact('application/vnd.cyclonedx+json')).toBe(false);
      expect(isTextArtifact('sbom.json')).toBe(false);
    });

    it('should reject unknown binary types', () => {
      expect(isTextArtifact('application/octet-stream')).toBe(false);
    });

    it('should handle artifact names with various extensions', () => {
      expect(isTextArtifact('pre-validation.log')).toBe(true);
      expect(isTextArtifact('stdout.log')).toBe(true);
      expect(isTextArtifact('cleanup.log')).toBe(true);
    });
  });

  describe('filterTextArtifacts', () => {
    it('should filter out non-text artifacts from a list', () => {
      const artifacts = [
        { name: 'metadata.json', contentType: 'application/json' },
        { name: 'archive.zip', contentType: 'application/zip' },
        { name: 'result-summary.md', contentType: 'text/markdown' },
        { name: 'sbom.json', contentType: 'application/vnd.cyclonedx+json' },
        { name: 'stdout.log', contentType: 'text/plain' },
      ];

      const filtered = filterTextArtifacts(artifacts);
      expect(filtered).toHaveLength(3);
      expect(filtered.map(a => a.name)).toEqual([
        'metadata.json',
        'result-summary.md',
        'stdout.log',
      ]);
    });

    it('should handle empty artifact list', () => {
      const filtered = filterTextArtifacts([]);
      expect(filtered).toHaveLength(0);
    });

    it('should handle list with only text artifacts', () => {
      const artifacts = [
        { name: 'metadata.json', contentType: 'application/json' },
        { name: 'result-summary.md', contentType: 'text/markdown' },
      ];

      const filtered = filterTextArtifacts(artifacts);
      expect(filtered).toHaveLength(2);
    });

    it('should handle list with only binary artifacts', () => {
      const artifacts = [
        { name: 'archive.zip', contentType: 'application/zip' },
        { name: 'sbom.json', contentType: 'application/vnd.cyclonedx+json' },
      ];

      const filtered = filterTextArtifacts(artifacts);
      expect(filtered).toHaveLength(0);
    });

    it('should preserve artifact order from registry', () => {
      const artifacts = [
        { name: 'failure.json', contentType: 'application/json' },
        { name: 'metadata.json', contentType: 'application/json' },
        { name: 'result-summary.md', contentType: 'text/markdown' },
      ];

      const filtered = filterTextArtifacts(artifacts);
      expect(filtered.map(a => a.name)).toEqual([
        'failure.json',
        'metadata.json',
        'result-summary.md',
      ]);
    });

    it('should work with artifact metadata from registry', () => {
      // Get a sample of actual artifacts from the registry
      const sampleArtifacts = Object.values(ARTIFACT_METADATA_REGISTRY).slice(0, 10);
      const filtered = filterTextArtifacts(sampleArtifacts);

      // All artifacts in the current registry should be text
      expect(filtered.length).toBe(sampleArtifacts.length);

      // Verify no binary artifacts in the filtered list
      filtered.forEach(artifact => {
        const binaryTypes = [
          'application/zip',
          'application/gzip',
          'application/x-tar',
          'application/vnd.cyclonedx+json',
          'application/octet-stream',
        ];
        expect(binaryTypes).not.toContain(artifact.contentType);
      });
    });
  });

  describe('Artifact registry validation', () => {
    it('should have all artifacts in the registry be text artifacts', () => {
      const allArtifacts = Object.values(ARTIFACT_METADATA_REGISTRY);

      const binaryArtifacts = allArtifacts.filter(artifact => !isTextArtifact(artifact.contentType));

      // As of current state, all artifacts should be text
      // This test ensures we're notified if binary artifacts are added
      expect(binaryArtifacts).toHaveLength(0);

      if (binaryArtifacts.length > 0) {
        const binaryNames = binaryArtifacts.map(a => a.name).join(', ');
        console.warn(`Binary artifacts found in registry: ${binaryNames}`);
      }
    });

    it('should classify representative user-facing registry artifacts for preview behavior', () => {
      const representativeArtifacts = [
        { name: 'failure.json', contentType: 'application/json', isText: true, previewableInline: true },
        { name: 'result-summary.md', contentType: 'text/markdown', isText: true, previewableInline: true },
        { name: 'pi-events.jsonl', contentType: 'application/x-jsonl', isText: true, previewableInline: true },
        { name: 'stderr.log', contentType: 'text/plain', isText: true, previewableInline: true },
        { name: 'validation-timings.tsv', contentType: 'text/tab-separated-values', isText: true, previewableInline: true },
      ];

      representativeArtifacts.forEach(({ name, contentType, isText, previewableInline }) => {
        const artifact = ARTIFACT_METADATA_REGISTRY[name];

        expect(artifact).toBeDefined();
        expect(artifact.contentType).toBe(contentType);
        expect(isTextArtifact(artifact.contentType)).toBe(isText);
        expect(shouldDisplayInline(artifact.contentType)).toBe(previewableInline);
      });
    });
  });
});
