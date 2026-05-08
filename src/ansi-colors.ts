/**
 * ANSI Color codes for terminal output
 * Only applied when outputting to a TTY
 */

export interface AnsiColorSet {
  RED: string;
  YELLOW: string;
  GREEN: string;
  BLUE: string;
  CYAN: string;
  MAGENTA: string;
  WHITE: string;
  RESET: string;
  BOLD: string;
  DIM: string;
}

/**
 * Check if output should be colored (not piped, is TTY)
 */
function shouldUseColor(): boolean {
  // Check if stdout is a TTY and TERM is not 'dumb'
  const isTTY = process.stdout?.isTTY ?? false;
  const notDumb = process.env.TERM !== 'dumb';
  const noColorEnv = process.env.NO_COLOR;

  return isTTY && notDumb && !noColorEnv;
}

/**
 * ANSI color codes
 * Only include actual colors if output is to a TTY
 */
export const ANSI_COLORS: AnsiColorSet = shouldUseColor()
  ? {
      RED: '\x1b[31m',
      YELLOW: '\x1b[33m',
      GREEN: '\x1b[32m',
      BLUE: '\x1b[34m',
      CYAN: '\x1b[36m',
      MAGENTA: '\x1b[35m',
      WHITE: '\x1b[37m',
      RESET: '\x1b[0m',
      BOLD: '\x1b[1m',
      DIM: '\x1b[2m',
    }
  : {
      RED: '',
      YELLOW: '',
      GREEN: '',
      BLUE: '',
      CYAN: '',
      MAGENTA: '',
      WHITE: '',
      RESET: '',
      BOLD: '',
      DIM: '',
    };

/**
 * Strip ANSI codes from a string
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
