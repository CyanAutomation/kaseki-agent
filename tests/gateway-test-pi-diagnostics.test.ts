/**
 * Integration tests for Pi provider smoke test with diagnostics
 * Tests various response scenarios including Cloudflare gateway variations
 */

import { extractSampleEventStructure, analyzeResponseStructure } from '../src/kaseki-api-gateway-test';

describe('Pi Provider Smoke Test Diagnostics', () => {
  describe('Sample Event Structure Extraction', () => {
    it('should extract sanitized structure from first 5 events', () => {
      const jsonl = [
        JSON.stringify({ type: 'thinking', thinking: 'Processing...' }),
        JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: 'response text' } }),
        JSON.stringify({ type: 'content_block_delta', message: { role: 'assistant', content: 'more' } }),
        JSON.stringify({ type: 'content_block_delta', message: { role: 'assistant', content: ' text' } }),
        JSON.stringify({ type: 'message_stop' }),
      ].join('\n');

      const samples = extractSampleEventStructure(jsonl);

      expect(samples).toHaveLength(5);
      expect(samples[0]).toHaveProperty('type');
      expect(typeof samples[0].type).toBe('string');
    });

    it('should sanitize sensitive string content', () => {
      const longText = 'a'.repeat(100);
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          content: longText,
          secret: 'sk-this-should-be-hidden',
        },
      });

      const samples = extractSampleEventStructure(jsonl);

      expect(samples).toHaveLength(1);
      // Verify the structure contains field metadata
      expect(samples[0]).toHaveProperty('type');
      // Verify strings are represented as types, not actual content
      expect(JSON.stringify(samples[0])).not.toContain('sk-this-should-be-hidden');
    });

    it('should limit structure depth to avoid huge outputs', () => {
      const deepNest = {
        type: 'event',
        message: {
          role: 'assistant',
          content: {
            nested: {
              very: {
                deeply: {
                  nested: {
                    object: {
                      with: {
                        many: 'levels',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const samples = extractSampleEventStructure(JSON.stringify(deepNest));

      // Should not crash and should sanitize deep nesting
      expect(samples).toHaveLength(1);
      expect(JSON.stringify(samples).length).toBeLessThan(500);
    });
  });

  describe('Response Structure Analysis', () => {
    it('should count events by type from real Pi JSONL', () => {
      const jsonl = [
        JSON.stringify({ type: 'thinking' }),
        JSON.stringify({ type: 'thinking' }),
        JSON.stringify({ type: 'message_start', message: { role: 'assistant', text: 'Hello' } }),
        JSON.stringify({ type: 'content_block_delta', message: { role: 'assistant', text: ' world' } }),
        JSON.stringify({ type: 'message_stop' }),
      ].join('\n');

      const analysis = analyzeResponseStructure(jsonl);

      expect(analysis.eventsByType['thinking']).toBe(2);
      expect(analysis.eventsByType['message_start']).toBe(1);
      expect(analysis.eventsByType['content_block_delta']).toBe(1);
      expect(analysis.eventsByType['message_stop']).toBe(1);
    });

    it('should suggest patterns based on found fields', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          choices: [
            {
              message: {
                content: 'response',
              },
            },
          ],
        },
      });

      const analysis = analyzeResponseStructure(jsonl);

      expect(analysis.suggestedPatterns).toContain('choices[0].message.content (Chat Completions)');
      expect(analysis.fieldsFound).toContain('message.choices[]');
    });

    it('should identify multiple field types in response', () => {
      const jsonl = JSON.stringify({
        type: 'event',
        message: {
          role: 'assistant',
          text: 'Option 1',
          choices: [
            {
              delta: {
                content: 'Option 2',
              },
            },
          ],
        },
      });

      const analysis = analyzeResponseStructure(jsonl);

      expect(analysis.fieldsFound).toContain('message.text');
      expect(analysis.fieldsFound).toContain('message.choices[]');
      expect(analysis.fieldsFound).toContain('message.choices[0].delta.content');
    });

    it('should count events with text content', () => {
      const jsonl = [
        JSON.stringify({ type: 'event1', message: { role: 'assistant', text: 'Has text' } }),
        JSON.stringify({ type: 'event2', message: { role: 'assistant', text: '' } }), // empty
        JSON.stringify({ type: 'event3', message: { role: 'assistant', content: 'More text' } }),
      ].join('\n');

      const analysis = analyzeResponseStructure(jsonl);

      expect(analysis.eventsWithText).toBeGreaterThan(0);
    });

    it('should handle Cloudflare-specific response format', () => {
      const cloudflareJsonl = JSON.stringify({
        type: 'message_start',
        message: {
          role: 'assistant',
          content: 'Cloudflare response with direct content field',
        },
      });

      const analysis = analyzeResponseStructure(cloudflareJsonl);

      expect(analysis.fieldsFound).toContain('message.content (string)');
      expect(analysis.suggestedPatterns).toContain('message.content string (Cloudflare)');
    });

    it('should return useful diagnostics when no text is found', () => {
      const emptyJsonl = [
        JSON.stringify({ type: 'event1', message: { role: 'assistant' } }),
        JSON.stringify({ type: 'event2', message: { role: 'assistant' } }),
      ].join('\n');

      const analysis = analyzeResponseStructure(emptyJsonl);

      expect(analysis.eventCount).toBe(2);
      expect(analysis.fieldsFound.length).toBe(0);
      expect(analysis.eventsWithText).toBe(0);
      expect(analysis.suggestedPatterns.length).toBe(0);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle OpenAI response format via OpenRouter', () => {
      const openrouterJsonl = [
        JSON.stringify({
          type: 'message_start',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'The answer is ',
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
                text: '42',
              },
            ],
          },
        }),
      ].join('\n');

      const analysis = analyzeResponseStructure(openrouterJsonl);

      expect(analysis.fieldsFound).toContain('message.content (array)');
      expect(analysis.fieldsFound).toContain('message.content[].text');
    });

    it('should detect failed Pi provider output (no text content)', () => {
      const failedPiOutput = [
        JSON.stringify({
          type: 'error',
          error: {
            type: 'api_error',
            message: 'Something went wrong',
          },
        }),
        JSON.stringify({
          type: 'message_stop',
        }),
      ].join('\n');

      const analysis = analyzeResponseStructure(failedPiOutput);

      expect(analysis.eventsWithText).toBe(0);
      expect(analysis.suggestedPatterns.length).toBe(0); // No text patterns to suggest
    });

    it('should suggest fixes for Cloudflare Chat Completions variant', () => {
      const cloudflareVariant = JSON.stringify({
        type: 'response',
        message: {
          role: 'assistant',
          choices: [
            {
              message: {
                content: 'Chat completions response from Cloudflare',
              },
            },
          ],
        },
      });

      const analysis = analyzeResponseStructure(cloudflareVariant);

      expect(analysis.suggestedPatterns.some(p => p.includes('Chat Completions'))).toBe(true);
    });

    it('should track multiple streaming chunks correctly', () => {
      const streamingResponse = [
        ...Array(10).fill(null).map((_,i) =>
          JSON.stringify({
            type: 'content_block_delta',
            message: {
              role: 'assistant',
              delta: {
                content: `chunk${i} `,
              },
            },
          })
        ),
      ].join('\n');

      const analysis = analyzeResponseStructure(streamingResponse);

      expect(analysis.eventCount).toBe(10);
      expect(analysis.eventsByType['content_block_delta']).toBe(10);
      expect(analysis.fieldsFound).toContain('message.delta.content');
      expect(analysis.suggestedPatterns).toContain('message.delta.content (streaming direct)');
    });
  });
});
