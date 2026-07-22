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

    it('should prohibit decorative output and style self-announcement [CAVEMAN-COMMS-001]', () => {
      // Caveman communication specification, CAVEMAN-COMMS-001:
      // require its communication rules and prohibit decorative output or style announcements.
      const contract = [
        { characteristic: 'terse, professional communication', required: true, pattern: /terse|professional/i },
        { characteristic: 'dropped articles', required: true, pattern: /drop.*article|article.*drop/i },
        { characteristic: 'dropped filler or pleasantries', required: true, pattern: /drop.*filler|filler.*drop|drop.*pleasantr/i },
        { characteristic: 'full or short sentences', required: true, pattern: /full\s+sentence|short\s+sentence/i },
        { characteristic: 'exact technical terms', required: true, pattern: /technical\s+terms?\s+(?:exact|unchanged|preserv)/i },
        { characteristic: 'unchanged code blocks', required: true, pattern: /code\s+blocks?\s+(?:exact|unchanged|preserv)/i },
        { characteristic: 'thing/action/reason/next-step pattern', required: true, pattern: /pattern.*thing.*action.*reason.*next\s+step|pattern|thing.*action|reason|next\s+step/i },
        { characteristic: 'no tool narration', required: true, pattern: /no\s+tool\s+narrat/i },
        { characteristic: 'standard acronyms', required: true, pattern: /standard\s+acronym|DB|API|HTTP/i },
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
  });
});
