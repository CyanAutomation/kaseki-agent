import { routeScoutingContext, type PhaseTransferCandidate, type PhaseTransferDecision } from './semantic-phase-transfer.js';

const candidateDecision = (candidate: PhaseTransferCandidate, choice: string): PhaseTransferDecision => ({
  type: 'choice',
  choice,
  confidence: 0.99,
  probabilities: { preserve: choice === 'preserve' ? 1 : 0, condense: choice === 'condense' ? 1 : 0, discard: choice === 'discard' ? 1 : 0 },
});

describe('semantic scouting phase transfer', () => {
  const scouting = () => ({
    inspectedFiles: [
      { path: 'README.md', reason: 'General repository introduction', facts: ['Contains a brief project overview', 'No implementation details'] },
      { path: 'src/router.ts', reason: 'Routes the requested API operation', facts: ['Uses a shared handler', 'Returns a typed response'] },
      { path: 'src/required.ts', reason: 'Required by the acceptance criteria', facts: ['Must remain in scope'] },
    ],
    implementationBrief: {
      observations: ['The route shares validation with the adjacent handler'],
      plan: ['Update the route and add focused tests'],
      required_files: ['src/required.ts'],
      protected_files: ['generated/client.ts'],
      test_impact: [{ path: 'test/router.test.ts', reason: 'Covers the route behavior' }],
    },
    goalSummary: 'Update the route without changing generated files',
  });

  it('batches bounded candidate decisions, retains protected files, and applies preserve/condense/discard', async () => {
    const classify = jest.fn(async (state: Record<string, unknown>) => {
      const candidates = state.candidates as PhaseTransferCandidate[];
      return { answers: Object.fromEntries(candidates.map(candidate => [candidate.id,
        candidateDecision(candidate, candidate.path === 'README.md' ? 'discard' : candidate.path === 'src/router.ts' ? 'condense' : 'preserve'),
      ])) };
    });

    const result = await routeScoutingContext(scouting(), { classify, enabled: true });

    expect(classify).toHaveBeenCalledTimes(1);
    const [state, questions] = classify.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect((state.candidates as PhaseTransferCandidate[]).length).toBe(5);
    expect(state).toMatchObject({ phase_from: 'scouting', phase_to: 'coding', goal_summary: 'Update the route without changing generated files' });
    expect((state.candidates as PhaseTransferCandidate[]).every(candidate => candidate.text.length <= 700)).toBe(true);
    expect((state.goal_summary as string).length).toBeLessThanOrEqual(1200);
    expect(JSON.stringify(state)).not.toContain('TASK_PROMPT');
    expect(Object.keys(questions)).toHaveLength(5);
    expect(result.inspectedFiles.map(item => item.path)).toEqual(['src/router.ts', 'src/required.ts']);
    expect(result.inspectedFiles[0].facts).toEqual(['Uses a shared handler', 'Returns a typed response']);
    expect(result.inspectedFiles[1].facts).toEqual(['Must remain in scope']);
    expect(result.implementationBrief.required_files).toEqual(['src/required.ts']);
    expect(result.implementationBrief.protected_files).toEqual(['generated/client.ts']);
    expect(result.metrics).toMatchObject({ evaluatedItems: 5, protectedItems: 1, preservedItems: 4, condensedItems: 1, discardedItems: 1, jevRequests: 1 });
  });

  it('preserves the complete existing handoff on JEV failure or when the feature is disabled', async () => {
    const input = scouting();
    const failed = await routeScoutingContext(input, { enabled: true, classify: async () => { throw new Error('offline'); } });
    const disabledClassifier = jest.fn();
    const disabled = await routeScoutingContext(input, { enabled: false, classify: disabledClassifier });

    expect(failed.inspectedFiles).toEqual(input.inspectedFiles);
    expect(failed.metrics).toMatchObject({ jevFailures: 1, preservedItems: 6, discardedItems: 0 });
    expect(disabledClassifier).not.toHaveBeenCalled();
    expect(disabled.inspectedFiles).toEqual(input.inspectedFiles);
    expect(disabled.metrics).toMatchObject({ jevRequests: 0, evaluatedItems: 0, preservedItems: 6 });
  });

  it('fails open for malformed probability distributions and honors threshold boundaries', async () => {
    const input = scouting();
    const invalid = await routeScoutingContext(input, {
      enabled: true,
      classify: async (state: Record<string, unknown>) => ({
        answers: Object.fromEntries((state.candidates as PhaseTransferCandidate[]).map(candidate => [candidate.id, {
          type: 'choice', choice: 'discard', confidence: 0.99,
          probabilities: { preserve: 0.2, condense: 0.2, discard: 0.2 },
        } satisfies PhaseTransferDecision])),
      }),
    });
    const atBoundary = await routeScoutingContext(input, {
      enabled: true,
      discardThreshold: 0.98,
      classify: async (state: Record<string, unknown>) => ({
        answers: Object.fromEntries((state.candidates as PhaseTransferCandidate[]).map(candidate => [candidate.id,
          candidateDecision(candidate, candidate.path === 'README.md' ? 'discard' : 'preserve'),
        ])),
      }),
    });

    expect(invalid.inspectedFiles).toEqual(input.inspectedFiles);
    expect(invalid.metrics.jevFailures).toBe(1);
    expect(atBoundary.inspectedFiles.map(item => item.path)).not.toContain('README.md');
    expect(atBoundary.metrics.discardedItems).toBe(1);
  });

  it('keeps the JEV envelope bounded and preserves candidates beyond its limit', async () => {
    const input = {
      inspectedFiles: [],
      implementationBrief: {
        observations: Array.from({ length: 34 }, (_, index) => `Observation ${index}`),
        plan: [],
        required_files: [],
        protected_files: [],
      },
      goalSummary: 'A bounded goal',
    };
    const classify = jest.fn(async (state: Record<string, unknown>) => {
      const candidates = state.candidates as PhaseTransferCandidate[];
      return { answers: Object.fromEntries(candidates.map(candidate => [candidate.id, candidateDecision(candidate, 'discard')])) };
    });

    const result = await routeScoutingContext(input, { classify, enabled: true });

    expect((classify.mock.calls[0]?.[0] as { candidates: unknown[] }).candidates).toHaveLength(32);
    expect(result.implementationBrief.observations).toEqual(['Observation 32', 'Observation 33']);
    expect(result.metrics).toMatchObject({ candidateCount: 34, evaluatedItems: 32, discardedItems: 32, preservedItems: 2 });
  });

  it('does not call JEV when there are no transferable facts', async () => {
    const classify = jest.fn();
    const result = await routeScoutingContext({ inspectedFiles: [], implementationBrief: {}, goalSummary: 'No candidates' }, { classify, enabled: true });

    expect(classify).not.toHaveBeenCalled();
    expect(result.metrics).toMatchObject({ status: 'no_candidates', candidateCount: 0, jevRequests: 0 });
  });

  it('redacts scouting facts from the bounded JEV envelope while preserving the original handoff value', async () => {
    let request: Record<string, unknown> | undefined;
    const fact = 'Configured credential token=supersecretvalue';
    const result = await routeScoutingContext({
      inspectedFiles: [],
      implementationBrief: { observations: [fact] },
      goalSummary: 'Review the credential handoff',
    }, {
      enabled: true,
      redact: value => value.replace('supersecretvalue', '[REDACTED_SECRET]'),
      classify: async state => {
        request = state;
        const candidates = state.candidates as PhaseTransferCandidate[];
        return { answers: Object.fromEntries(candidates.map(candidate => [candidate.id, candidateDecision(candidate, 'preserve')])) };
      },
    });

    expect(JSON.stringify(request)).not.toContain('supersecretvalue');
    expect(result.implementationBrief.observations).toEqual([fact]);
  });
});
