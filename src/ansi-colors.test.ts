import { describe, it, expect } from '@jest/globals';
import { ANSI_COLORS, stripAnsi } from '../src/ansi-colors';

describe('ansi-colors', () => {
  describe('ANSI_COLORS', () => {
    it('exports color constants', () => {
      // Colors might be empty strings if not a TTY, but should exist
      expect(ANSI_COLORS).toHaveProperty('RED');
      expect(ANSI_COLORS).toHaveProperty('YELLOW');
      expect(ANSI_COLORS).toHaveProperty('GREEN');
      expect(ANSI_COLORS).toHaveProperty('BLUE');
      expect(ANSI_COLORS).toHaveProperty('RESET');
    });

    it('exports formatting codes', () => {
      expect(ANSI_COLORS).toHaveProperty('BOLD');
      expect(ANSI_COLORS).toHaveProperty('DIM');
    });

    it('color codes are strings (possibly empty)', () => {
      expect(typeof ANSI_COLORS.RED).toBe('string');
      expect(typeof ANSI_COLORS.YELLOW).toBe('string');
      expect(typeof ANSI_COLORS.RESET).toBe('string');
    });
  });

  describe('stripAnsi', () => {
    it('removes red color codes', () => {
      const text = `${ANSI_COLORS.RED}error message${ANSI_COLORS.RESET}`;
      const stripped = stripAnsi(text);
      expect(stripped).toBe('error message');
    });

    it('removes multiple color codes', () => {
      const text = `${ANSI_COLORS.YELLOW}warn${ANSI_COLORS.RESET} and ${ANSI_COLORS.RED}error${ANSI_COLORS.RESET}`;
      const stripped = stripAnsi(text);
      expect(stripped).toBe('warn and error');
    });

    it('handles text without color codes', () => {
      const text = 'plain text';
      expect(stripAnsi(text)).toBe('plain text');
    });

    it('removes bold and dim codes', () => {
      const text = `${ANSI_COLORS.BOLD}bold${ANSI_COLORS.RESET} ${ANSI_COLORS.DIM}dim${ANSI_COLORS.RESET}`;
      const stripped = stripAnsi(text);
      expect(stripped).toBe('bold dim');
    });

    it('handles empty string', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('removes all ANSI escape sequences', () => {
      // Test with raw ANSI codes
      const text = '\x1b[31mred\x1b[0m \x1b[33myellow\x1b[0m';
      const stripped = stripAnsi(text);
      expect(stripped).toBe('red yellow');
    });
  });
});
