export interface RunnerImageProjection {
  imageReference?: string;
  imageId?: string;
}

/** Project only the runner's non-secret image identity into API responses. */
export function projectRunnerImage(metadata: Record<string, unknown>): RunnerImageProjection | undefined {
  const imageReference = safeImageReference(metadata.runner_image_reference);
  const imageId = safeImageId(metadata.runner_image_id);
  if (!imageReference && !imageId) return undefined;
  return {
    ...(imageReference ? { imageReference } : {}),
    ...(imageId ? { imageId } : {}),
  };
}

function safeImageReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const reference = value.trim();
  if (!reference || reference.length > 512 || /[\s?#]/.test(reference) || reference.includes('://')) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(reference)) return undefined;
  if (reference.includes('@') && !/@sha256:[a-f0-9]{64}$/i.test(reference)) return undefined;
  return reference;
}

function safeImageId(value: unknown): string | undefined {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value) ? value : undefined;
}
