import { projectRunnerImage } from './runner-image-projection';

describe('projectRunnerImage', () => {
  it('returns a valid image reference and content-addressed image ID', () => {
    expect(projectRunnerImage({
      runner_image_reference: 'ghcr.io/cyan/kaseki-runner:1.159.1',
      runner_image_id: `sha256:${'a'.repeat(64)}`,
    })).toEqual({
      imageReference: 'ghcr.io/cyan/kaseki-runner:1.159.1',
      imageId: `sha256:${'a'.repeat(64)}`,
    });
  });

  it('omits malformed values and references containing inline credentials', () => {
    expect(projectRunnerImage({
      runner_image_reference: 'https://user:password@registry.example/runner',
      runner_image_id: 'sha256:not-a-digest',
    })).toBeUndefined();
  });
});
