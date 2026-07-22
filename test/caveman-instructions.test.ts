/**
 * Test suite for Caveman instruction library
 * Uses TDD approach: define expectations first, then implement
 *
 * This suite validates:
 * - Caveman instruction text follows Caveman skill rules
 * - No self-reference (no "caveman mode", "me think", etc.)
 * - Proper structure and formatting
 * - Technical accuracy and exact terminology preserved
 */

import { getCavemanInstruction } from '../src/caveman/caveman-instructions';

describe('Caveman Instructions Library', () => {
  describe('getCavemanInstruction()', () => {
    let instruction: string;

    beforeAll(() => {
      instruction = getCavemanInstruction();
    });

    it('should return a non-empty string', () => {
      expect(instruction).toBeDefined();
      expect(typeof instruction).toBe('string');
      expect(instruction.length).toBeGreaterThan(0);
    });

    it('should be marked as a communication mode directive', () => {
      // Should clearly identify this as instructions for terse communication
      expect(instruction.toLowerCase()).toMatch(/terse|drop|brief|compress|short|fragment/i);
    });

    it('should stay concise without sacrificing technical precision', () => {
      // Concision is a behavior contract: remove low-value prose while preserving exact content.
      expect(instruction.toLowerCase()).toMatch(/drop.*article|article.*drop/i);
      expect(instruction.toLowerCase()).toMatch(/drop.*filler|filler.*drop|drop.*pleasantr/i);
      expect(instruction.toLowerCase()).toMatch(/technical\s+terms?\s+(?:exact|unchanged|preserv)/i);
      expect(instruction.toLowerCase()).toMatch(/code\s+blocks?\s+(?:exact|unchanged|preserv)/i);
    });

    it('should allow fragments and short sentences', () => {
      expect(instruction.toLowerCase()).toMatch(/fragment|short|sentence|break.*line/i);
    });

    it('should prohibit decorative output and style self-announcement [CAVEMAN-COMMS-001]', () => {
      // Caveman communication specification, CAVEMAN-COMMS-001:
      // no emoji, decorative tables, or announcement of the communication style.
      expect(instruction).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(instruction).not.toMatch(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/m);
      expect(instruction).not.toMatch(/[┌┬┐├┼┤└┴┘╔╦╗╠╬╣╚╩╝]/u);
      expect(instruction).not.toMatch(
        /\b(?:caveman(?:\s+mode)?|me\s+caveman|caveman\s+(?:think|speak))\b/i,
      );
    });

    it('should establish the pattern: [thing] [action] [reason]. [next step].', () => {
      // Caveman skill pattern example
      expect(instruction.toLowerCase()).toMatch(/pattern|thing.*action|reason|next\s+step/i);
    });

    it('should mention no tool-call narration', () => {
      // Caveman skill: No tool-call narration
      expect(instruction.toLowerCase()).toMatch(/tool|narrat|don't\s+narrat|no\s+narrat/i);
    });

    it('should specify acceptable acronyms (standard only, no invented)', () => {
      // Caveman skill: Standard well-known tech acronyms OK; never invent new abbreviations
      expect(instruction.toLowerCase()).toMatch(/acronym|abbreviat|standar|invented|DB|API|HTTP/i);
    });

    it('should be a complete, standalone instruction (no continuation)', () => {
      // Instruction should not end with "..." or imply continuation
      expect(instruction).not.toMatch(/\.\.\.\s*$/);
      expect(instruction).not.toMatch(/continued\s*$/i);
    });
  });

  describe('Integration with Caveman skill rules', () => {
    let instruction: string;

    beforeAll(() => {
      instruction = getCavemanInstruction();
    });

    it('should follow the lite intensity guidelines from Caveman skill', () => {
      // Lite: No filler/hedging. Keep articles + full sentences. Professional but tight.
      // Should contain at least professional AND (full sentences OR keep)
      expect(instruction.toLowerCase()).toMatch(/professional|terse/i);
      expect(instruction.toLowerCase()).toMatch(/full\s+sentence|keep\s+full/i);
    });

    it('should provide example or demonstration pattern', () => {
      // Helps implementer understand the style
      expect(instruction.toLowerCase()).toMatch(/example|pattern|bug|fix/i);
    });
  });
});
