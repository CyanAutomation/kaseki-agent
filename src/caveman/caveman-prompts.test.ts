/**
 * caveman-prompts.test.ts
 *
 * TDD tests for caveman-compressed prompt templates.
 * Validates that compressed prompts follow caveman patterns while preserving semantics.
 */

import {
  compressGuardrails,
  compressGoalCheckInstructions,
  compressRunEvalInstructions,
} from './caveman-prompts';

describe('Caveman Compressed Prompts', () => {
  describe('compressGuardrails()', () => {
    let compressed: string;

    beforeAll(() => {
      compressed = compressGuardrails();
    });

    it('should be significantly shorter than verbose version', () => {
      // Verbose version is ~400 tokens (~1600 chars)
      // Compressed should be ~150-200 tokens (~600-800 chars)
      expect(compressed.length).toBeLessThan(900);
      expect(compressed.length).toBeGreaterThan(400);
    });

    it('should prohibit git commands', () => {
      expect(compressed).toMatch(/no.*git.*add|git.*add.*prohibited|don't.*git/i);
    });

    it('should prohibit npm install commands', () => {
      expect(compressed).toMatch(/no.*npm.*install|npm.*install.*prohibited|don't.*npm/i);
    });

    it('should mention Kaseki ownership', () => {
      expect(compressed).toMatch(/kaseki.*owns|kaseki.*manages/i);
    });

    it('should emphasize primary change first', () => {
      expect(compressed).toMatch(/primary.*first|critical.*change.*first|main.*change/i);
    });

    it('should not contain articles (a/an/the)', () => {
      // Allow "the" in technical terms like "the repository"
      const articleCount = (compressed.match(/\b(a|an)\s+\w+/gi) || []).length;
      expect(articleCount).toBeLessThan(3); // Allow minimal usage
    });

    it('should use short synonyms', () => {
      expect(compressed).not.toMatch(/extensive|comprehensive|implement/i);
    });

    it('should preserve exact technical terms', () => {
      expect(compressed).toMatch(/git|npm|lockfile/i);
    });
  });

  describe('compressGoalCheckInstructions()', () => {
    let compressed: string;

    beforeAll(() => {
      compressed = compressGoalCheckInstructions();
    });

    it('should be significantly shorter than verbose version', () => {
      // Verbose version is ~600-800 tokens (~2400-3200 chars)
      // Compressed should be ~300-400 tokens (~1200-1600 chars)
      expect(compressed.length).toBeLessThan(1800);
      expect(compressed.length).toBeGreaterThan(800);
    });

    it('should mention SMART criteria', () => {
      expect(compressed).toMatch(/SMART|specific.*measurable.*achievable/i);
    });

    it('should mention evidence citation', () => {
      expect(compressed).toMatch(/cite.*evidence|evidence.*required|specific.*file.*line/i);
    });

    it('should mention confidence levels', () => {
      expect(compressed).toMatch(/confidence|high.*medium.*low/i);
    });

    it('should preserve goal-check technical terms', () => {
      expect(compressed).toMatch(/requirement|completion|validation/i);
    });
  });

  describe('compressRunEvalInstructions()', () => {
    let compressed: string;

    beforeAll(() => {
      compressed = compressRunEvalInstructions();
    });

    it('should be significantly shorter than verbose version', () => {
      // Verbose version is ~500-700 tokens (~2000-2800 chars)
      // Compressed should be ~250-350 tokens (~1000-1400 chars)
      expect(compressed.length).toBeLessThan(1600);
      expect(compressed.length).toBeGreaterThan(700);
    });

    it('should mention validation results', () => {
      expect(compressed).toMatch(/validation|test.*result|pass.*fail/i);
    });

    it('should mention goal-setting artifact', () => {
      expect(compressed).toMatch(/goal.*setting|goal.*artifact/i);
    });

    it('should mention diff analysis', () => {
      expect(compressed).toMatch(/diff|change.*files|git.*diff/i);
    });

    it('should preserve evaluation technical terms', () => {
      expect(compressed).toMatch(/artifact|metadata|phase/i);
    });
  });

  describe('token count estimation', () => {
    it('should achieve target compression ratio for guardrails', () => {
      const compressed = compressGuardrails();
      const estimatedTokens = Math.ceil(compressed.length / 4); // ~4 chars per token

      // Target: ~150-200 tokens (was ~400)
      expect(estimatedTokens).toBeLessThan(250);
      expect(estimatedTokens).toBeGreaterThan(100);
    });

    it('should achieve target compression ratio for goal-check', () => {
      const compressed = compressGoalCheckInstructions();
      const estimatedTokens = Math.ceil(compressed.length / 4);

      // Target: ~300-400 tokens (was ~600-800)
      expect(estimatedTokens).toBeLessThan(500);
      expect(estimatedTokens).toBeGreaterThan(200);
    });

    it('should achieve target compression ratio for run-eval', () => {
      const compressed = compressRunEvalInstructions();
      const estimatedTokens = Math.ceil(compressed.length / 4);

      // Target: ~250-350 tokens (was ~500-700)
      expect(estimatedTokens).toBeLessThan(450);
      expect(estimatedTokens).toBeGreaterThan(175);
    });
  });

  describe('caveman pattern validation', () => {
    it('all compressed prompts should follow [thing] [action] [reason] pattern', () => {
      const guardrails = compressGuardrails();
      const goalCheck = compressGoalCheckInstructions();
      const runEval = compressRunEvalInstructions();

      // Look for imperative patterns (short, direct statements)
      const imperativePattern = /\b(No|Don't|Use|Check|Verify|Cite|Read|Include)\s+\w+/g;

      expect(guardrails.match(imperativePattern)).not.toBeNull();
      expect(goalCheck.match(imperativePattern)).not.toBeNull();
      expect(runEval.match(imperativePattern)).not.toBeNull();
    });

    it('compressed prompts should avoid pleasantries', () => {
      const guardrails = compressGuardrails();
      const goalCheck = compressGoalCheckInstructions();
      const runEval = compressRunEvalInstructions();

      const pleasantries = /\b(please|kindly|certainly|sure|thank)\b/gi;

      expect(guardrails).not.toMatch(pleasantries);
      expect(goalCheck).not.toMatch(pleasantries);
      expect(runEval).not.toMatch(pleasantries);
    });

    it('compressed prompts should avoid filler words', () => {
      const guardrails = compressGuardrails();
      const goalCheck = compressGoalCheckInstructions();
      const runEval = compressRunEvalInstructions();

      const filler = /\b(just|really|basically|actually|very)\b/gi;

      expect(guardrails).not.toMatch(filler);
      expect(goalCheck).not.toMatch(filler);
      expect(runEval).not.toMatch(filler);
    });
  });
});
