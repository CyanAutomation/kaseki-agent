export function messageEndEvent(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'message_end',
    message: { role: 'assistant', model: 'gateway-model', usage: { input: 1, output: 1 }, ...overrides },
  });
}

export function responseIdFixture(): string[] {
  return [
    { responseId: 'camel-id', response_id: 'snake-id' },
    { response_id: 'snake-only-id' },
    { responseId: 42, response_id: 'snake-fallback-id' },
  ].map(messageEndEvent);
}
