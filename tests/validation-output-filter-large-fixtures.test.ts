import { filterValidationOutput } from '../src/validation-output-filter';

function buildValidationFixture(verboseLineCount: number): string {
  const lines = ['validation preamble', '==> Running deterministic validation fixture'];

  for (let index = 1; index <= verboseLineCount; index++) {
    lines.push(`verbose fixture line ${index}: ${'x'.repeat(48)}`);
  }

  lines.push('PASS fixture suite completed');
  lines.push('WARN fixture warning retained');
  lines.push('ERROR fixture failure context retained');
  lines.push('exit_code=1');

  return `${lines.join('\n')}\n`;
}

describe('validation-output-filter large deterministic fixtures', () => {
  it('retains exact validation markers while filtering bounded large verbose input', () => {
    const output = filterValidationOutput(buildValidationFixture(20_000));

    expect(output).toBe([
      'validation preamble',
      '==> Running deterministic validation fixture',
      'PASS fixture suite completed',
      'WARN fixture warning retained',
      'ERROR fixture failure context retained',
      'exit_code=1',
      '',
    ].join('\n'));
  });

  it('preserves exact large error line content without sleep or shell pipelines', () => {
    const largeErrorPayload = 'E'.repeat(128 * 1024);
    const output = filterValidationOutput([
      '==> Running deterministic single-line fixture',
      `ERROR ${largeErrorPayload}`,
      'exit_code=1',
      '',
    ].join('\n'));

    expect(output).toBe([
      '==> Running deterministic single-line fixture',
      `ERROR ${largeErrorPayload}`,
      'exit_code=1',
      '',
    ].join('\n'));
  });

  it('filters exact verbose markers between retained command boundaries', () => {
    const output = filterValidationOutput([
      '==> Running bounded fixture',
      'npm notice noisy package metadata',
      'ordinary verbose line that should be truncated from live output',
      '✓ retained success marker',
      'exit_code=0',
      '',
    ].join('\n'));

    expect(output).toBe([
      '==> Running bounded fixture',
      '✓ retained success marker',
      'exit_code=0',
      '',
    ].join('\n'));
  });
});
