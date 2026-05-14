import { afterEach, describe, it, expect, jest } from '@jest/globals';
import { ANSI_COLORS, stripAnsi } from '../src/ansi-colors';

const originalTerm = process.env.TERM;
const originalNoColor = process.env.NO_COLOR;
const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function setStdoutIsTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: isTTY,
  });
}

function restoreStdoutIsTTY(): void {
  if (originalIsTTYDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', originalIsTTYDescriptor);
  } else {
    delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

afterEach(() => {
  process.env.TERM = originalTerm;

  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }

  restoreStdoutIsTTY();
  jest.resetModules();
});

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
  });

  describe('stripAnsi', () => {
    it('strips text wrapped with enabled color constants and reset', async () => {
      setStdoutIsTTY(true);
      process.env.TERM = 'xterm-256color';
      delete process.env.NO_COLOR;
      jest.resetModules();

      const { ANSI_COLORS: enabledColors, stripAnsi: stripFreshAnsi } = await import('../src/ansi-colors');
      const enabledConstantNames = [
        'RED',
        'YELLOW',
        'GREEN',
        'BLUE',
        'CYAN',
        'MAGENTA',
        'WHITE',
        'BOLD',
        'DIM',
      ] as const;

      expect(enabledColors.RESET).not.toBe('');

      for (const constantName of enabledConstantNames) {
        const plainText = `${constantName.toLowerCase()} message`;

        expect(enabledColors[constantName]).not.toBe('');
        expect(stripFreshAnsi(`${enabledColors[constantName]}${plainText}${enabledColors.RESET}`)).toBe(plainText);
      }
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

    it('normalizes formatted terminal text to plain text', () => {
      const formattedTerminalText = '\x1b[1m\x1b[31mError:\x1b[0m \x1b[2mretrying request\x1b[0m';
      expect(stripAnsi(formattedTerminalText)).toBe('Error: retrying request');
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
