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
      // Get a sample of actual artifacts from the registry.
      const sampleArtifacts = Object.values(ARTIFACT_METADATA_REGISTRY).slice(0, 10);
      const filtered = filterTextArtifacts(sampleArtifacts);

      // Match the classifier contract rather than requiring every registry artifact to be text.
      expect(filtered).toEqual(
        sampleArtifacts.filter(artifact => isTextArtifact(artifact.contentType))
      );
    });
  });

  describe('Artifact registry validation', () => {
    it('should define the text preview and download-only artifact contract', () => {
      const previewableArtifacts = [
        { name: 'metadata.json', contentType: 'application/json' },
        { name: 'result-summary.md', contentType: 'text/markdown' },
        { name: 'analysis.md', contentType: 'text/markdown' },
        { name: 'inspect-report.md', contentType: 'text/markdown' },
        { name: 'failure.json', contentType: 'application/json' },
        { name: 'pi-events.jsonl', contentType: 'application/x-jsonl' },
        { name: 'pi-summary.json', contentType: 'application/json' },
        { name: 'goal-setting.json', contentType: 'application/json' },
        { name: 'goal-setting-summary.json', contentType: 'application/json' },
        { name: 'goal-setting-events.jsonl', contentType: 'application/x-jsonl' },
        { name: 'goal-setting-stderr.log', contentType: 'text/plain' },
        { name: 'goal-setting-validation-errors.jsonl', contentType: 'application/x-jsonl' },
        { name: 'goal-setting-metrics.json', contentType: 'application/json' },
        { name: 'scouting.json', contentType: 'application/json' },
        { name: 'scouting-summary.json', contentType: 'application/json' },
        { name: 'scouting-events.jsonl', contentType: 'application/x-jsonl' },
        { name: 'scouting-events.raw.jsonl', contentType: 'application/x-jsonl' },
        { name: 'scouting-stderr.log', contentType: 'text/plain' },
        { name: 'scouting-validation-errors.jsonl', contentType: 'application/x-jsonl' },
        { name: 'scouting-validation-summary.txt', contentType: 'text/plain' },
        { name: 'goal-check.json', contentType: 'application/json' },
        { name: 'goal-check-attempts.jsonl', contentType: 'application/x-jsonl' },
        { name: 'goal-check-events.jsonl', contentType: 'application/x-jsonl' },
        { name: 'goal-check-summary.json', contentType: 'application/json' },
        { name: 'goal-check-stderr.log', contentType: 'text/plain' },
        { name: 'goal-check-validation-errors.jsonl', contentType: 'application/x-jsonl' },
        { name: 'run-evaluation.json', contentType: 'application/json' },
        { name: 'run-evaluation-events.jsonl', contentType: 'application/x-jsonl' },
        { name: 'run-evaluation-summary.json', contentType: 'application/json' },
        { name: 'run-evaluation-stderr.log', contentType: 'text/plain' },
        { name: 'progress.log', contentType: 'text/plain' },
        { name: 'progress.jsonl', contentType: 'application/x-jsonl' },
        { name: 'stdout.log', contentType: 'text/plain' },
        { name: 'stderr.log', contentType: 'text/plain' },
        { name: 'pre-validation.log', contentType: 'text/plain' },
        { name: 'pre-validation-timings.tsv', contentType: 'text/tab-separated-values' },
        { name: 'validation.log', contentType: 'text/plain' },
        { name: 'validation-timings.tsv', contentType: 'text/tab-separated-values' },
        { name: 'quality.log', contentType: 'text/plain' },
        { name: 'stage-timings.tsv', contentType: 'text/tab-separated-values' },
        { name: 'git.diff', contentType: 'text/plain' },
        { name: 'git.status', contentType: 'text/plain' },
        { name: 'changed-files.txt', contentType: 'text/plain' },
        { name: 'git-push.log', contentType: 'text/plain' },
        { name: 'restoration.jsonl', contentType: 'application/x-jsonl' },
        { name: 'restoration-report.md', contentType: 'text/markdown' },
        { name: 'secret-scan.log', contentType: 'text/plain' },
        { name: 'dependency-cache.log', contentType: 'text/plain' },
        { name: 'exit_code', contentType: 'text/plain' },
        { name: 'format-check-command.txt', contentType: 'text/plain' },
      ];
      const downloadOnlyArtifacts = [
        { name: 'archive.zip', contentType: 'application/zip' },
        { name: 'debug-bundle.tar', contentType: 'application/x-tar' },
        { name: 'logs.tar.gz', contentType: 'application/gzip' },
        { name: 'sbom.json', contentType: 'application/vnd.cyclonedx+json' },
        { name: 'raw-output.bin', contentType: 'application/octet-stream' },
      ];

      previewableArtifacts.forEach(expectedArtifact => {
        expect(ARTIFACT_METADATA_REGISTRY[expectedArtifact.name]).toMatchObject(expectedArtifact);
        expect(isTextArtifact(expectedArtifact.contentType)).toBe(true);
        expect(isTextArtifact(expectedArtifact.name)).toBe(true);
      });

      downloadOnlyArtifacts.forEach(expectedArtifact => {
        expect(isTextArtifact(expectedArtifact.contentType)).toBe(false);
        expect(isTextArtifact(expectedArtifact.name)).toBe(false);
      });

      const previewableArtifactByName = new Map(
        previewableArtifacts.map(artifact => [artifact.name, artifact])
      );
      const previewableArtifact = (name: string) => {
        const artifact = previewableArtifactByName.get(name);
        expect(artifact).toBeDefined();
        return artifact!;
      };
      const mixedRegistryFixture = [
        previewableArtifact('metadata.json'),
        downloadOnlyArtifacts[0],
        previewableArtifact('result-summary.md'),
        downloadOnlyArtifacts[1],
        previewableArtifact('pi-events.jsonl'),
        downloadOnlyArtifacts[2],
        previewableArtifact('pre-validation-timings.tsv'),
        downloadOnlyArtifacts[3],
        previewableArtifact('format-check-command.txt'),
        downloadOnlyArtifacts[4],
      ];

      expect(filterTextArtifacts(mixedRegistryFixture)).toEqual([
        previewableArtifact('metadata.json'),
        previewableArtifact('result-summary.md'),
        previewableArtifact('pi-events.jsonl'),
        previewableArtifact('pre-validation-timings.tsv'),
        previewableArtifact('format-check-command.txt'),
      ]);
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
