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

const STRUCTURED_MESSAGE_PATTERN =
  /(?=[\s\S]*\bthing\b)(?=[\s\S]*\baction\b)(?=[\s\S]*\breason\b)(?=[\s\S]*\bnext\s+step\b)/i;
const STANDARD_ACRONYM_PATTERN =
  /(?:(?=[\s\S]*\bacronyms?\b)(?=[\s\S]*\b(?:standard|abbreviat\w*|invented)\b)|(?=[\s\S]*\bDB\b)(?=[\s\S]*\b(?:API|HTTP)\b))/i;

describe('Caveman Instructions Library', () => {
  describe('getCavemanInstruction()', () => {
    let instruction: string;

    beforeAll(() => {
      instruction = getCavemanInstruction();
    });

    it('should prohibit decorative output and style self-announcement [CAVEMAN-COMMS-001]', () => {
      // Caveman communication specification, CAVEMAN-COMMS-001:
      // require its communication rules and prohibit decorative output or style announcements.
      // Keep alternatives permissive: each accepted term comes from the assertions consolidated here.
      const contract = [
        {
          characteristic: 'terse, professional communication',
          required: true,
          pattern: /terse|professional|drop|brief|compress|short|fragment/i,
        },
        { characteristic: 'dropped articles', required: true, pattern: /drop.*article|article.*drop/i },
        { characteristic: 'dropped filler or pleasantries', required: true, pattern: /drop.*filler|filler.*drop|drop.*pleasantr/i },
        {
          characteristic: 'full or short sentences',
          required: true,
          pattern: /full\s+sentence|short\s+sentence|fragment|break.*line/i,
        },
        { characteristic: 'exact technical terms', required: true, pattern: /technical\s+terms?\s+(?:exact|unchanged|preserv)/i },
        { characteristic: 'unchanged code blocks', required: true, pattern: /code\s+blocks?\s+(?:exact|unchanged|preserv)/i },
        {
          characteristic: 'thing/action/reason/next-step pattern',
          required: true,
          pattern: STRUCTURED_MESSAGE_PATTERN,
        },
        {
          characteristic: 'no tool narration',
          required: true,
          pattern: /tool.*narrat|narrat.*tool|don't\s+narrat|no\s+narrat/i,
        },
        {
          characteristic: 'standard acronyms',
          required: true,
          pattern: STANDARD_ACRONYM_PATTERN,
        },
        { characteristic: 'example', required: true, pattern: /example|bug.*fix/i },
        { characteristic: 'emoji', required: false, pattern: /\p{Extended_Pictographic}/u },
        { characteristic: 'Markdown table separator', required: false, pattern: /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/m },
        { characteristic: 'box-drawing table', required: false, pattern: /[┌┬┐├┼┤└┴┘╔╦╗╠╬╣╚╩╝]/u },
        { characteristic: 'style self-announcement', required: false, pattern: /\b(?:caveman(?:\s+mode)?|me\s+caveman|caveman\s+(?:think|speak))\b/i },
        { characteristic: 'ellipsis continuation', required: false, pattern: /\.\.\.\s*$/ },
        { characteristic: 'explicit continuation', required: false, pattern: /continued\s*$/i },
      ];

      for (const { characteristic, required, pattern } of contract) {
        expect({ characteristic, satisfied: pattern.test(instruction) === required }).toEqual({
          characteristic,
          satisfied: true,
        });
      }
    });

    it('should reject incomplete communication contract fragments', () => {
      for (const fragment of ['pattern', 'thing action', 'reason', 'next step']) {
        expect(STRUCTURED_MESSAGE_PATTERN.test(fragment)).toBe(false);
      }

      for (const fragment of ['acronym', 'DB', 'API', 'HTTP']) {
        expect(STANDARD_ACRONYM_PATTERN.test(fragment)).toBe(false);
      }
    });
  });
});
