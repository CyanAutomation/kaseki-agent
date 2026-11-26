export type FetchFaultEffect =
  | { kind: 'response'; response: Response }
  | { kind: 'reject'; error: Error }
  /** Waits, then continues the before/after flow: before runs the handler; after returns its response. */
  | { kind: 'delay'; milliseconds: number };

export interface FetchFaultRule {
  method: string;
  pathSuffix: string;
  phase: 'before' | 'after';
  effect: FetchFaultEffect;
  skip?: number;
  times?: number;
}

/** Applies deterministic transport faults around a stateful fake Soyuz handler. */
export function createScriptedFetch(
  handler: typeof fetch,
  rules: readonly FetchFaultRule[],
): typeof fetch {
  const state = rules.map((rule) => ({
    rule,
    skip: rule.skip ?? 0,
    remaining: rule.times ?? 1,
  }));

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const scripted = state.find(({ rule, skip, remaining }) => remaining > 0
      && rule.method === method && url.pathname.endsWith(rule.pathSuffix) && skip === 0);
    if (scripted) scripted.remaining -= 1;
    else {
      const skipped = state.find(({ rule, skip, remaining }) => remaining > 0
        && rule.method === method && url.pathname.endsWith(rule.pathSuffix) && skip > 0);
      if (skipped) skipped.skip -= 1;
    }

    if (scripted?.rule.phase === 'before') {
      const result = await applyFault(scripted.rule.effect, init?.signal);
      if (result !== undefined) return result;
    }

    const response = await handler(input, init);
    if (scripted?.rule.phase === 'after') {
      const replacement = await applyFault(scripted.rule.effect, init?.signal);
      return replacement ?? response;
    }
    return response;
  };
}

async function applyFault(effect: FetchFaultEffect, signal?: AbortSignal | null): Promise<Response | undefined> {
  if (effect.kind === 'response') return effect.response;
  if (effect.kind === 'reject') throw effect.error;
  await delayWithAbort(effect.milliseconds, signal);
  return undefined;
}

function delayWithAbort(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const error = new Error('The scripted request was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
