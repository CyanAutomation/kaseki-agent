/**
 * Pi CLI Custom Extension: LLM Gateway Provider
 *
 * Registers a custom LLM gateway provider that reads endpoint and API key
 * from environment variables.
 *
 * Configuration Environment Variables:
 * - LLM_GATEWAY_URL: Gateway API endpoint (required; base URL only, e.g., https://llmgateway.local.xyz/v1)
 *   NOTE: Pi CLI automatically appends /responses for the openai-responses API type.
 *   So LLM_GATEWAY_URL=https://llmgateway.local.xyz/v1 results in requests to /v1/responses.
 * - LLM_GATEWAY_API_KEY: API key literal (optional, prefer file)
 * - LLM_GATEWAY_API_KEY_FILE: Path to file containing API key
 * - LLM_GATEWAY_MODEL: Model selector (optional, defaults to "auto")
 *
 * DIAGNOSTICS:
 * - Extension load diagnostics written to /results/.gateway-diagnostics.jsonl
 * - Records: extension load, provider registration, model resolution, api type confirmation
 * - Does NOT attempt fetch/undici normalization (Pi uses undici directly, which bypasses fetch)
 */

import fs from 'node:fs';

// Log extension module load for diagnostics
const extensionLoadDiagnostic = {
  timestamp: new Date().toISOString(),
  event: 'extension_module_loaded',
  piExtensionsVersion: 'gateway-provider-v1',
};

// Try to write diagnostic immediately (best effort)
try {
  if (fs.existsSync('/results')) {
    fs.appendFileSync(
      '/results/.gateway-diagnostics.jsonl',
      JSON.stringify(extensionLoadDiagnostic) + '\n',
      'utf8'
    );
  }
} catch {
  // Silent: /results may not exist during extension load
}

function resolveGatewayApiKey() {
  if (process.env.LLM_GATEWAY_API_KEY) {
    return process.env.LLM_GATEWAY_API_KEY;
  }

  const filePath = process.env.LLM_GATEWAY_API_KEY_FILE;
  if (filePath) {
    try {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    } catch {
      // Pi will surface the provider initialization failure to the caller.
    }
  }

  return '';
}

function resolveGatewayMaxTokens() {
  const raw = process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;
  if (!raw) return 4096;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

/**
 * Normalize request payload for OpenAI Responses API compatibility
 *
 * Converts multi-message array input to messages field:
 * - {input: [{role, content}]} → {messages: [{role, content}]}
 * - {input: "string"} → {input: "string"} (unchanged)
 *
 * @param {Record<string, any>} request - Request payload
 * @returns {{normalized: Record<string, any>, wasNormalized: boolean}} Normalized request and flag
 */
function normalizeGatewayRequest(request) {
  const { input, ...rest } = request;

  // Check if input is a multi-message array (array of {role, content} objects)
  if (
    Array.isArray(input) &&
    input.length > 0 &&
    input.every(item =>
      typeof item === 'object' &&
      item !== null &&
      'role' in item &&
      'content' in item,
    )
  ) {
    // Convert multi-message array to messages field
    // This is required for OpenAI Responses API when sending conversation history
    return {
      normalized: {
        ...rest,
        messages: input,
      },
      wasNormalized: true,
    };
  }

  // Keep input field as-is (string or invalid format)
  // String inputs are passed through unchanged for simple prompts
  // Malformed arrays will be caught by the gateway error handling
  return { normalized: { input, ...rest }, wasNormalized: false };
}

/**
 * Extract and parse JSON body from request options or Buffer
 *
 * @param {string | Buffer | undefined} body - Request body
 * @returns {{parsed: Record<string, any> | null}} Parsed body
 */
function parseRequestBody(body) {
  if (!body) {
    return { parsed: null };
  }

  try {
    const bodyStr = typeof body === 'string' ? body : body.toString('utf8');
    return { parsed: JSON.parse(bodyStr) };
  } catch {
    return { parsed: null };
  }
}

/**
 * Create a fetch wrapper that normalizes request payloads
 * This intercepts fetch calls to apply normalization before sending to gateway
 *
 * @param {Function} originalFetch - The original fetch function
 * @returns {Function} Wrapped fetch function that normalizes requests
 */
function createNormalizedFetch(originalFetch) {
  return async function normalizedFetch(url, options) {
    // Only normalize requests to /responses endpoints
    if (typeof url === 'string' && url.includes('/responses')) {
      try {
        const opts = { ...options };
        const { parsed } = parseRequestBody(opts.body);

        if (parsed) {
          const { normalized, wasNormalized } = normalizeGatewayRequest(parsed);
          if (wasNormalized) {
            opts.body = JSON.stringify(normalized);
            recordGatewayDiagnostic('fetch', 'normalized', { from: 'array', to: 'messages' });
          } else {
            recordGatewayDiagnostic('fetch', 'passthrough', { format: typeof parsed.input });
          }
        }
        return originalFetch(url, opts);
      } catch (error) {
        // If normalization fails, log and proceed with original request
        recordGatewayDiagnostic('fetch', 'error', { reason: error?.message || 'unknown' });
        return originalFetch(url, options);
      }
    }

    // Pass through all other requests unchanged
    return originalFetch(url, options);
  };
}

/**
 * Create an undici request wrapper that normalizes request payloads
 * Note: Reserved for future use if Pi CLI transitions to using global.fetch
 * or if extension hooks become available. Currently, we rely on fetch wrapper.
 *
 * @param {Function} originalRequest - The original undici.request function
 * @returns {Function} Wrapped request function that normalizes payloads
 */
// eslint-disable-next-line no-unused-vars
function _createNormalizedUndiciRequest(originalRequest) {
  return async function normalizedRequest(options, factory) {
    // Only normalize requests to /responses endpoints
    if (
      typeof options === 'object' &&
      options.path &&
      typeof options.path === 'string' &&
      options.path.includes('/responses')
    ) {
      try {
        const opts = { ...options };
        const { parsed } = parseRequestBody(opts.body);

        if (parsed) {
          const { normalized, wasNormalized } = normalizeGatewayRequest(parsed);
          if (wasNormalized) {
            opts.body = JSON.stringify(normalized);
            recordGatewayDiagnostic('undici', 'normalized', { from: 'array', to: 'messages' });
          } else {
            recordGatewayDiagnostic('undici', 'passthrough', { format: typeof parsed.input });
          }
        }
        return originalRequest(opts, factory);
      } catch (error) {
        // If normalization fails, log and proceed with original request
        recordGatewayDiagnostic('undici', 'error', { reason: error?.message || 'unknown' });
        return originalRequest(options, factory);
      }
    }

    // Pass through all other requests unchanged
    return originalRequest(options, factory);
  };
}

/**
 * Record diagnostic events for gateway request normalization
 * Stores in global for access by monitoring/logging subsystems
 * Also writes to file if /results directory exists for artifact collection
 *
 * @param {string} transport - 'fetch' or 'undici'
 * @param {string} action - 'normalized', 'passthrough', 'error'
 * @param {Record<string, any>} details - Diagnostic details
 */
function recordGatewayDiagnostic(transport, action, details) {
  if (!global.__kasekiGatewayDiagnostics) {
    global.__kasekiGatewayDiagnostics = [];
  }

  const event = {
    timestamp: new Date().toISOString(),
    transport,
    action,
    details,
  };

  global.__kasekiGatewayDiagnostics.push(event);

  // Also try to write to /results/.gateway-diagnostics.jsonl if available
  // This ensures diagnostics are captured even if process is killed
  try {
    if (fs.existsSync('/results')) {
      const diagnosticsFile = '/results/.gateway-diagnostics.jsonl';
      fs.appendFileSync(diagnosticsFile, JSON.stringify(event) + '\n', 'utf8');
    }
  } catch {
    // Silently ignore file write errors (directory might not be writable or available)
  }
}

// Store original fetch before patching
const originalFetch = global.fetch;

// Patch global fetch with normalization wrapper (if not already patched)
if (originalFetch && !process.env.PI_EXTENSIONS_GATEWAY_FETCH_PATCHED) {
  global.fetch = createNormalizedFetch(originalFetch);
  process.env.PI_EXTENSIONS_GATEWAY_FETCH_PATCHED = 'true';
}

// Note: Undici patching is deferred to Pi CLI extension hooks if available
// The fetch wrapper above will catch requests made through fetch API
// Diagnostic events are still recorded to .gateway-diagnostics.jsonl file
// for visibility into all request normalization attempts
if (!process.env.PI_EXTENSIONS_GATEWAY_INIT_COMPLETE) {
  process.env.PI_EXTENSIONS_GATEWAY_INIT_COMPLETE = 'true';
}

/**
 * Extract user input from Pi's context message history
 * @param {object} context - Pi execution context with messages array
 * @returns {string} Extracted user input text
 */
function extractUserInputFromContext(context) {
  if (!context || !context.messages || !Array.isArray(context.messages)) {
    throw new Error('No messages in context');
  }

  // Find the last user message (iterate backwards)
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const msg = context.messages[i];
    if (msg.role === 'user') {
      // Handle both string and content block formats
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        // Extract and concatenate all text blocks
        return msg.content
          .filter(block => block && block.type === 'text')
          .map(block => block.text || '')
          .join('');
      }
      return String(msg.content);
    }
  }

  throw new Error('No user message found in context');
}

/**
 * Custom stream handler for LLM Gateway provider
 * Converts Pi's message format to gateway's input format and processes SSE responses
 *
 * streamSimple handlers in Pi must return a Node.js Readable stream.
 * The stream emits JSON objects as lines (JSONL format).
 * Each line is a streaming event that Pi parses.
 *
 * @param {object} model - Model configuration (id, provider, api, etc.)
 * @param {object} context - Pi execution context with messages, tools, etc.
 * @param {object} options - Stream options (signal for abort, etc.)
 * @returns {Readable} Node.js Readable stream emitting JSONL events
 */
function createGatewayStreamHandler(gatewayUrl, gatewayApiKey) {
  // Import Node.js stream utilities
  const { Readable } = require('stream');

  return function streamGatewayProvider(model, context, options) {
    // Create a readable stream that will emit Pi-compatible events
    const readable = new Readable({
      read() {
        // Stream will be pushed to externally
      },
    });

    // Async handler for gateway communication
    (async () => {
      try {
        // ENTRY GUARD: Log handler invocation immediately
        recordGatewayDiagnostic('stream_handler', 'entry', {
          timestamp: new Date().toISOString(),
          modelId: model?.id || 'unknown',
          modelType: model?.reasoning ? 'reasoning' : 'standard',
          contextMessageCount: context?.messages?.length || 0,
          contextKeys: context ? Object.keys(context) : [],
        });

        // CONTEXT VALIDATION: Check context shape before access
        if (!context) {
          recordGatewayDiagnostic('stream_handler', 'context_validation_failed', {
            reason: 'context_null',
            errorMessage: 'Context object is null or undefined',
          });
          throw new Error('Context is null or undefined');
        }

        if (!Array.isArray(context.messages)) {
          recordGatewayDiagnostic('stream_handler', 'context_validation_failed', {
            reason: 'messages_not_array',
            contextType: typeof context.messages,
            contextKeys: Object.keys(context),
          });
          throw new Error(
            `Context.messages must be an array, got ${typeof context.messages}`
          );
        }

        if (context.messages.length === 0) {
          recordGatewayDiagnostic('stream_handler', 'context_validation_failed', {
            reason: 'messages_empty',
            messageCount: 0,
          });
          throw new Error('No messages in context');
        }

        recordGatewayDiagnostic('stream_handler', 'context_validation_passed', {
          messageCount: context.messages.length,
          lastMessageRole: context.messages[context.messages.length - 1]?.role,
        });

        // Record diagnostic: stream handler invoked
        recordGatewayDiagnostic('stream_handler', 'invoked', {
          model: model.id,
          contextMessageCount: context?.messages?.length || 0,
        });

        // Extract user input from context
        const userInput = extractUserInputFromContext(context);

        recordGatewayDiagnostic('stream_handler', 'input_extracted', {
          inputLength: userInput.length,
          inputPreview: userInput.substring(0, 100),
          // eslint-disable-next-line no-control-regex
          hasControlChars: /[\x00-\x1F\x7F]/.test(userInput),
        });

        // Build request in gateway's expected format
        const requestBody = {
          model: model.id || 'auto',
          input: userInput,
          store: false,
        };

        // REQUEST PAYLOAD LOGGING: Log exact structure sent to gateway
        recordGatewayDiagnostic('stream_handler', 'request_payload', {
          model: requestBody.model,
          inputLength: requestBody.input.length,
          inputPreview: requestBody.input.substring(0, 100),
          store: requestBody.store,
          requestBodySize: JSON.stringify(requestBody).length,
          validJsonFormat: true,
        });

        recordGatewayDiagnostic('stream_handler', 'request_built', {
          requestKeys: Object.keys(requestBody),
          inputFormat: typeof requestBody.input,
        });

        // Make request to gateway
        recordGatewayDiagnostic('stream_handler', 'gateway_request_start', {
          url: `${gatewayUrl}/responses`,
          method: 'POST',
          timestamp: new Date().toISOString(),
        });
        const response = await fetch(`${gatewayUrl}/responses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gatewayApiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: options?.signal,
        });

        if (!response.ok) {
          // Capture error response details for diagnostics
          const errorBody = await response.text().catch(() => '<unable to read>');
          recordGatewayDiagnostic('stream_handler', 'gateway_http_error', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            errorBodyPreview: errorBody.substring(0, 200),
            errorBodyLength: errorBody.length,
          });
          throw new Error(
            `Gateway HTTP ${response.status}: ${response.statusText}`
          );
        }

        recordGatewayDiagnostic('stream_handler', 'response_received', {
          status: response.status,
          contentType: response.headers.get('content-type'),
          hasBody: !!response.body,
          timestamp: new Date().toISOString(),
        });

        // Parse SSE stream from gateway
        const reader = response.body.getReader();
        // @ts-expect-error - TextDecoder is available in Node.js runtime
        // eslint-disable-next-line no-undef
        const decoder = new TextDecoder();
        let buffer = '';
        let textContent = '';
        let usage = null;

        // Emit start event
        readable.push(
          JSON.stringify({
            type: 'start',
            partial: {
              role: 'assistant',
              content: [],
              api: 'custom-gateway',
              provider: 'gateway',
              model: model.id || 'auto',
              timestamp: Date.now(),
            },
          }) + '\n'
        );

        // Process SSE stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            // Parse SSE data: lines
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6);
                // Skip [DONE] marker
                if (jsonStr === '[DONE]') {
                  break;
                }

                const event = JSON.parse(jsonStr);

                // Extract text from response.output array
                if (
                  event.response &&
                  event.response.output &&
                  Array.isArray(event.response.output)
                ) {
                  for (const block of event.response.output) {
                    if (block && block.type === 'text' && block.text) {
                      textContent = block.text;
                    }
                  }
                }

                // Collect usage metrics from any response event
                if (event.response && event.response.usage) {
                  usage = event.response.usage;
                }
              } catch {
                // Silently ignore parse errors (SSE comments, etc.)
              }
            }
          }
        }

        recordGatewayDiagnostic('stream_handler', 'stream_parsed', {
          textLength: textContent.length,
          hasUsage: !!usage,
        });

        // Emit text events if we got content
        if (textContent) {
          readable.push(
            JSON.stringify({
              type: 'text_start',
              contentIndex: 0,
            }) + '\n'
          );

          readable.push(
            JSON.stringify({
              type: 'text_delta',
              contentIndex: 0,
              delta: textContent,
            }) + '\n'
          );

          readable.push(
            JSON.stringify({
              type: 'text_end',
              contentIndex: 0,
              content: textContent,
            }) + '\n'
          );
        }

        // Emit done event with usage metrics
        const doneEvent = {
          type: 'done',
          stopReason: 'stop',
          message: {
            role: 'assistant',
            content: textContent ? [{ type: 'text', text: textContent }] : [],
            usage: usage
              ? {
                input_tokens: usage.input_tokens || 0,
                output_tokens: usage.output_tokens || 0,
                cache_read_tokens: usage.cache_read_tokens || 0,
                cache_write_tokens: usage.cache_write_tokens || 0,
              }
              : {
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
              },
          },
        };

        readable.push(JSON.stringify(doneEvent) + '\n');
        recordGatewayDiagnostic('stream_handler', 'stream_complete', {
          totalTokens:
            (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
        });

        // End stream
        readable.push(null);
      } catch (error) {
        // Handle any errors during streaming with detailed context
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        const stopReason = options?.signal?.aborted ? 'aborted' : 'error';

        recordGatewayDiagnostic('stream_handler', 'error', {
          reason: stopReason,
          message: errorMsg,
          errorType: error?.constructor?.name || 'Unknown',
          stackPreview: errorStack.split('\n').slice(0, 3).join(' | '),
          timestamp: new Date().toISOString(),
        });

        // Emit error event
        readable.push(
          JSON.stringify({
            type: 'error',
            reason: stopReason,
            error: {
              message: errorMsg,
              errorMessage: errorMsg,
            },
          }) + '\n'
        );

        // End stream
        readable.push(null);
      }
    })();

    return readable;
  };
}

export default function registerGatewayProvider(pi) {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayApiKey = resolveGatewayApiKey();
  const maxTokens = resolveGatewayMaxTokens();

  // If gateway is configured, register the provider
  if (gatewayUrl) {
    // Create custom stream handler with captured gateway config
    const streamHandler = createGatewayStreamHandler(gatewayUrl, gatewayApiKey);

    // Register provider with custom stream handling
    pi.registerProvider('gateway', {
      name: 'LLM Gateway',
      baseUrl: gatewayUrl,
      apiKey: gatewayApiKey || '$LLM_GATEWAY_API_KEY',
      api: 'custom-gateway',  // Custom API type - we handle streaming ourselves
      streamSimple: streamHandler,  // Use custom stream handler instead of built-in formatter
      models: [
        {
          id: 'auto',
          name: 'Auto (Gateway Default)',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens,
        },
      ],
    });

    // Write provider registration diagnostic
    const providerDiagnostic = {
      timestamp: new Date().toISOString(),
      event: 'provider_registered',
      provider: 'gateway',
      baseUrl: gatewayUrl,
      apiType: 'custom-gateway',
      streamingHandler: 'custom-streamSimple',
      modelId: 'auto',
      hasApiKey: !!gatewayApiKey,
    };

    try {
      if (fs.existsSync('/results')) {
        fs.appendFileSync(
          '/results/.gateway-diagnostics.jsonl',
          JSON.stringify(providerDiagnostic) + '\n',
          'utf8'
        );
      }
    } catch {
      // Silent: diagnostics not critical to provider functionality
    }
  } else {
    // No gateway URL configured
    const noDiagnostic = {
      timestamp: new Date().toISOString(),
      event: 'provider_skipped',
      reason: 'no_LLM_GATEWAY_URL',
    };
    try {
      if (fs.existsSync('/results')) {
        fs.appendFileSync(
          '/results/.gateway-diagnostics.jsonl',
          JSON.stringify(noDiagnostic) + '\n',
          'utf8'
        );
      }
    } catch {
      // Silent
    }
  }
}
