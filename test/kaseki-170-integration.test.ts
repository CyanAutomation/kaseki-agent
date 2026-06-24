/**
 * Integration Test: Kaseki-170 Empty Assistant Turn Scenario
 *
 * This test demonstrates the complete flow of:
 * 1. Detecting an empty assistant turn (gateway returns 200 with no content)
 * 2. Validating the response structure
 * 3. Logging diagnostic information
 * 4. Providing actionable feedback for debugging
 *
 * Scenario: Gateway's openai-responses adapter returns:
 * - HTTP 200 (success)
 * - output_tokens: 146
 * - content: null (BUG)
 * - response_id: resp_4e859d2bfb3a457cb34d1e485d0b2958
 */

import { validateProviderResponse, extractEmptyAssistantDiagnostics } from '../src/provider-response-validation';
import {
  ProviderDiagnosticsLogger,
  initializeProviderDiagnosticsLogger,
} from '../src/provider-diagnostics-logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Integration: Kaseki-170 Empty Assistant Turn Flow', () => {
  let tempDir: string;
  let logger: ProviderDiagnosticsLogger;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-170-integration-'));
    logger = initializeProviderDiagnosticsLogger(tempDir);
  });

  afterEach(() => {
    logger.flush();
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    }
  });

  it('should detect and log kaseki-170 empty assistant turn', () => {
    // Exact reproduction of kaseki-170 provider response
    const kaseki170Response = {
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: null,  // ← THE BUG
        provider: 'gateway',
        api: 'openai-responses',
        model: 'auto',
        response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      },
      usage: {
        input_tokens: 9019,
        output_tokens: 146,  // ← Claims 146 tokens but content is null!
        total_tokens: 9165,
      },
      response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
    };

    // Step 1: Validate response
    const validation = validateProviderResponse(kaseki170Response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors[0]).toContain('Output tokens');
    expect(validation.errors[0]).toContain('146');

    // Step 2: Extract diagnostics
    const diagnostics = extractEmptyAssistantDiagnostics(kaseki170Response);

    expect(diagnostics.provider).toBe('gateway');
    expect(diagnostics.api).toBe('openai-responses');
    expect(diagnostics.outputTokens).toBe(146);
    expect(diagnostics.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');

    // Step 3: Log the diagnostic
    logger.logEmptyAssistantTurn(
      'scouting',
      diagnostics.provider || 'unknown',
      diagnostics.api || 'unknown',
      diagnostics.model || 'unknown',
      diagnostics.inputTokens,
      diagnostics.outputTokens,
      diagnostics.responseId,
      kaseki170Response
    );

    logger.flush();

    // Step 4: Verify diagnostic was written to file
    const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
    expect(fs.existsSync(diagnosticsPath)).toBe(true);

    const content = fs.readFileSync(diagnosticsPath, 'utf-8');
    const diagnostic = JSON.parse(content.trim());

    expect(diagnostic.phase).toBe('scouting');
    expect(diagnostic.errorType).toBe('empty_assistant_turn');
    expect(diagnostic.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');
  });

  it('should provide actionable debugging guidance', () => {
    const kaseki170Response = {
      message: {
        role: 'assistant',
        content: null,
        provider: 'gateway',
        api: 'openai-responses',
        model: 'auto',
      },
      usage: {
        input_tokens: 9019,
        output_tokens: 146,
        total_tokens: 9165,
      },
    };

    // Extract diagnostics
    const diagnostics = extractEmptyAssistantDiagnostics(kaseki170Response);

    // Verify the description is actionable
    expect(diagnostics.description).toContain('146 output tokens');
    expect(diagnostics.description).toContain('no assistant text or tool calls');

    // Log with full response for debugging
    logger.logEmptyAssistantTurn(
      'scouting',
      'gateway',
      'openai-responses',
      'auto',
      9019,
      146,
      'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      kaseki170Response
    );

    logger.flush();

    const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
    const content = fs.readFileSync(diagnosticsPath, 'utf-8');
    const diagnostic = JSON.parse(content.trim());

    // Verify suggestions for gateway-specific debugging
    expect(diagnostic.suggestedAction).toContain('manifest.scheimann.xyz');
    expect(diagnostic.suggestedAction).toContain('openai-responses adapter');

    // Verify full response is captured for deep debugging
    expect(diagnostic.fullResponseBody).toBeDefined();
    expect(diagnostic.fullResponseBody).toContain('content');
  });

  it('should track multiple distinct errors', () => {
    // Log empty assistant turn from first run
    logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, 'resp_1');

    // Simulate retry with different model (not auto)
    logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'gpt-4', 100, 200, 'resp_2');

    // Log timeout from second run
    logger.logProviderError('scouting', 'gateway', 'openai-responses', 'auto', 'timeout', 'Timeout after 30s');

    logger.flush();

    const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
    const content = fs.readFileSync(diagnosticsPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Should have 3 distinct diagnostics
    expect(lines.length).toBe(3);

    const diagnostics = lines.map((line) => JSON.parse(line));
    expect(diagnostics[0].errorType).toBe('empty_assistant_turn');
    expect(diagnostics[0].model).toBe('auto');
    expect(diagnostics[1].errorType).toBe('empty_assistant_turn');
    expect(diagnostics[1].model).toBe('gpt-4');
    expect(diagnostics[2].errorType).toBe('timeout');
  });

  it('should summarize error patterns for monitoring', () => {
    // Simulate multiple empty assistant turns from same provider/api
    for (let i = 0; i < 3; i++) {
      logger.logEmptyAssistantTurn(
        'scouting',
        'gateway',
        'openai-responses',
        'auto',
        100 + i * 100,
        146,
        `resp_${i}`
      );
    }

    const summary = logger.getSummary();

    // Only one unique key since all have same provider:api:model:output_tokens
    expect(Object.keys(summary).length).toBeGreaterThan(0);
  });

  it('should enable debugging workflow', () => {
    /**
     * Workflow for debugging kaseki-170:
     * 1. Run kaseki and encounter exit 86
     * 2. Check provider-diagnostics.jsonl for details
     * 3. Use response_id to trace in gateway logs
     * 4. Review suggested actions (manifest.scheimann.xyz endpoint)
     * 5. Implement gateway fix based on error
     */

    const kaseki170Response = {
      message: {
        role: 'assistant',
        content: null,
        provider: 'gateway',
        api: 'openai-responses',
        model: 'auto',
        response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      },
      usage: {
        input_tokens: 9019,
        output_tokens: 146,
        total_tokens: 9165,
      },
      response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
    };

    // Log with all details for debugging
    logger.logEmptyAssistantTurn(
      'scouting',
      'gateway',
      'openai-responses',
      'auto',
      9019,
      146,
      'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      kaseki170Response
    );

    logger.flush();

    // Read back the diagnostic file
    const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
    const diagnostic = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf-8'));

    // Verify all fields needed for debugging are present
    expect(diagnostic.timestamp).toBeDefined();
    expect(diagnostic.phase).toBe('scouting');
    expect(diagnostic.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');
    expect(diagnostic.inputTokens).toBe(9019);
    expect(diagnostic.outputTokens).toBe(146);
    expect(diagnostic.errorMessage).toBeDefined();
    expect(diagnostic.suggestedAction).toBeDefined();
    expect(diagnostic.fullResponseBody).toBeDefined();

    // Verify it can be used to create an error report
    const errorReport = {
      run: 'kaseki-170',
      exitCode: 86,
      rootCause: diagnostic.errorMessage,
      provider: diagnostic.provider,
      api: diagnostic.api,
      responseId: diagnostic.responseId,
      debuggingSteps: [
        `Trace response ID ${diagnostic.responseId} in gateway logs`,
        'Check openai-responses adapter response serialization',
        'Verify response.message.content is populated from provider',
        'Check for field name mismatches or truncation',
      ],
      suggestedActions: diagnostic.suggestedAction.split(';').map((s) => s.trim()),
    };

    expect(errorReport.rootCause).toContain('zero assistant content');
    expect(errorReport.debuggingSteps.length).toBe(4);
    expect(errorReport.suggestedActions.length).toBeGreaterThan(0);
  });
});
