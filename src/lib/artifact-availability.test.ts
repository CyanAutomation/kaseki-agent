import {
  getArtifactStatus,
  isArtifactAvailable,
  getArtifactUnavailableReason,
} from './artifact-availability';

describe('artifact availability', () => {
  it('rejects unknown artifacts', () => {
    expect(getArtifactStatus('does-not-exist', 'completed', true, 1)).toBe('not-found');
  });

  it('keeps terminal-only artifacts unavailable while a job is running', () => {
    expect(getArtifactStatus('failure.json', 'running', true, 10)).toBe('not-available-yet');
  });

  it('reports materialized always-available artifacts', () => {
    expect(getArtifactStatus('metadata.json', 'completed', true, 10)).toBe('available');
    expect(isArtifactAvailable('metadata.json', 'completed', true, 10)).toBe(true);
  });

  it('distinguishes empty terminal artifacts from unavailable state', () => {
    expect(getArtifactStatus('metadata.json', 'completed', false, 0)).toBe('not-found');
    expect(getArtifactUnavailableReason('not-found', 'metadata.json')).toContain('metadata.json');
  });
});
