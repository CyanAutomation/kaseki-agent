import { extractPiJsonAssistantText } from './extract-pi-json';

describe('extractPiJsonAssistantText', () => {
  it('prefers the richest cumulative assistant snapshot per event', () => {
    const stdout = [
      JSON.stringify({ message: { role: 'assistant', text: '{"status"' } }),
      JSON.stringify({ message: { role: 'assistant', text: '{"status":"ok"}' } }),
    ].join('\n');

    expect(extractPiJsonAssistantText(stdout)).toBe('{"status":"ok"}');
  });

  it('combines independent streaming deltas across supported fields', () => {
    const stdout = [
      JSON.stringify({ message: { role: 'assistant', choices: [{ delta: { content: 'Hello ' } }] } }),
      JSON.stringify({ message: { role: 'assistant', delta: { content: 'world' } } }),
      JSON.stringify({ message: { role: 'assistant', response: { content: '!' } } }),
    ].join('\n');

    expect(extractPiJsonAssistantText(stdout)).toBe('Hello world!');
  });

  it('collects content array parts and ignores malformed or non-assistant events', () => {
    const stdout = [
      '{not json',
      JSON.stringify({ message: { role: 'user', content: 'ignored' } }),
      JSON.stringify({
        message: {
          role: 'assistant',
          content: [
            { text: 'part ' },
            { output_text: 'two ' },
            { content: 'three' },
          ],
        },
      }),
    ].join('\n');

    expect(extractPiJsonAssistantText(stdout)).toBe('part two three');
  });
});
