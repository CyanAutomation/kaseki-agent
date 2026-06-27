/**
 * Unit tests for Pi provider response pattern extraction
 * Tests various Chat Completions response formats (standard, streaming, Cloudflare variants)
 */

import { extractPiJsonAssistantText, analyzeResponseStructure } from '../src/kaseki-api-gateway-test';

describe('extractPiJsonAssistantText', () => {
  describe('Standard Pi JSONL formats (legacy)', () => {
    it('should extract text from message.text field', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          text: 'Hello world',
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Hello world');
    });

    it('should extract text from message.output_text field', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          output_text: 'Output response',
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Output response');
    });

    it('should extract text from message.assistantMessage field', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          assistantMessage: 'Assistant says',
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Assistant says');
    });

    it('should extract text from message.content array', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Part 1 ' },
            { type: 'text', text: 'Part 2' },
          ],
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Part 1 Part 2');
    });

    it('should accumulate text across multiple JSONL lines', () => {
      const jsonl = [
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'First ',
          },
        }),
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'second ',
          },
        }),
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'third',
          },
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('First second third');
    });
  });

  describe('Chat Completions API formats (standard)', () => {
    it('should extract from choices[0].message.content', () => {
      const jsonl = JSON.stringify({
        type: 'message_start',
        message: {
          role: 'assistant',
          choices: [
            {
              message: {
                content: 'Chat completions response',
              },
            },
          ],
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Chat completions response');
    });

    it('should extract from choices[0].delta.content (streaming)', () => {
      const jsonl = [
        JSON.stringify({
          type: 'content_block_delta',
          message: {
            role: 'assistant',
            choices: [
              {
                delta: {
                  content: 'Stream ',
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'content_block_delta',
          message: {
            role: 'assistant',
            choices: [
              {
                delta: {
                  content: 'chunk',
                },
              },
            ],
          },
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Stream chunk');
    });

    it('should extract from message.choices[0].message.content (variant)', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          choices: [
            {
              message: {
                content: 'Variant format',
              },
            },
          ],
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Variant format');
    });

    it('should extract from top-level message.content field (Cloudflare)', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          content: 'Cloudflare direct content',
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Cloudflare direct content');
    });
  });

  describe('Cloudflare gateway variants', () => {
    it('should handle Cloudflare nested response structure', () => {
      const jsonl = [
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            response: {
              content: 'Cloudflare nested',
            },
          },
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Cloudflare nested');
    });

    it('should handle Cloudflare with both choices and direct content', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          choices: [
            {
              message: {
                content: 'Primary',
              },
            },
          ],
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Primary');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should ignore non-JSON lines', () => {
      const jsonl = [
        'some non-json text',
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'Valid',
          },
        }),
        'more non-json',
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Valid');
    });

    it('should ignore non-assistant role messages', () => {
      const jsonl = [
        JSON.stringify({
          type: 'event',
          message: {
            role: 'user',
            text: 'User input',
          },
        }),
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'Assistant output',
          },
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Assistant output');
    });

    it('should handle malformed JSON gracefully', () => {
      const jsonl = [
        '{"unclosed": ',
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'Valid',
          },
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Valid');
    });

    it('should return empty string when no text found', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          metadata: {},
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('');
    });

    it('should ignore events without message field', () => {
      const jsonl = [
        JSON.stringify({
          type: 'start',
          data: { some: 'value' },
        }),
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            text: 'Found',
          },
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Found');
    });

    it('should handle empty content arrays', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          content: [],
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('');
    });

    it('should handle null/undefined values gracefully', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          text: null,
          output_text: undefined,
          assistantMessage: 'Found here',
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toBe('Found here');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle actual Pi CLI with OpenRouter response', () => {
      const jsonl = [
        JSON.stringify({
          type: 'thinking',
          thinking: 'Processing request...',
        }),
        JSON.stringify({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'This is ',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'content_block_delta',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'the response',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'message_stop',
        }),
      ].join('\n');
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toContain('This is');
      expect(result).toContain('the response');
    });

    it('should extract test prompt echo from Pi provider smoke', () => {
      const testPrompt = 'kaseki pi provider smoke ok';
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          text: testPrompt,
        },
      });
      const result = extractPiJsonAssistantText(jsonl);
      expect(result).toContain('kaseki pi provider smoke ok');
    });
  });
});

describe('analyzeResponseStructure', () => {
  it('should identify fields present in JSONL response', () => {
    const jsonl = [
      JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          text: 'Content',
          metadata: { key: 'value' },
        },
      }),
    ].join('\n');
    const analysis = analyzeResponseStructure(jsonl);
    expect(analysis).toHaveProperty('fieldsFound');
    expect(analysis.fieldsFound).toContain('message.text');
    expect(analysis).toHaveProperty('eventCount');
    expect(analysis.eventCount).toBe(1);
  });

  it('should count events by type', () => {
    const jsonl = [
      JSON.stringify({ type: 'thinking' }),
      JSON.stringify({ type: 'message_start', message: { role: 'assistant', text: 'A' } }),
      JSON.stringify({ type: 'content_block_delta', message: { role: 'assistant', text: 'B' } }),
      JSON.stringify({ type: 'message_stop' }),
    ].join('\n');
    const analysis = analyzeResponseStructure(jsonl);
    expect(analysis.eventsByType).toHaveProperty('thinking');
    expect(analysis.eventsByType).toHaveProperty('message_start');
  });

  it('should identify which events contain text', () => {
    const jsonl = [
      JSON.stringify({
        type: 'event1',
        message: { role: 'assistant' },
      }),
      JSON.stringify({
        type: 'event2',
        message: { role: 'assistant', text: 'Found' },
      }),
    ].join('\n');
    const analysis = analyzeResponseStructure(jsonl);
    expect(analysis).toHaveProperty('eventsWithText');
    expect(analysis.eventsWithText).toBeGreaterThan(0);
  });

  it('should suggest patterns that might work', () => {
    const jsonl = JSON.stringify({
      type: 'event',
      message: {
        role: 'assistant',
        choices: [{ message: { content: 'Test' } }],
      },
    });
    const analysis = analyzeResponseStructure(jsonl);
    expect(analysis).toHaveProperty('suggestedPatterns');
    expect(Array.isArray(analysis.suggestedPatterns)).toBe(true);
  });
});
