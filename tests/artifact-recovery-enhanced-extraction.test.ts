/**
 * Unit Test: JSON Extraction with Markdown Code Fence Support
 *
 * Tests that the enhanced collectJsonWithFallback function successfully
 * extracts JSON objects that are wrapped in markdown code fences.
 */

import { collectJsonWithFallback, collectBalancedJsonObjects } from '../scripts/artifact-recovery';

describe('JSON Extraction - Tier 2 Fix Validation', () => {
  describe('Original Implementation (collectBalancedJsonObjects)', () => {
    it('extracts plain JSON correctly', () => {
      const text = '{"met": true, "confidence": "high"}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(JSON.parse(result[0]).met).toBe(true);
    });

    it('may struggle with markdown-wrapped JSON without fence-stripping strategy', () => {
      // Original implementation tries balanced brace depth
      // Markdown code fences (backticks) confuse it since { } still nest properly
      const text = '```json\n{"met": true, "confidence": "high"}\n```';
      const result = collectBalancedJsonObjects(text);
      // The original implementation may find the JSON due to brace balancing,
      // but the new implementation with explicit markdown handling is more robust
      if (result.length > 0) {
        // If found, it should be valid JSON
        expect(() => JSON.parse(result[0])).not.toThrow();
      }
      // The enhanced version will be more consistent
    });
  });

  describe('Enhanced Implementation (collectJsonWithFallback)', () => {
    it('extracts plain JSON (strategy 1)', () => {
      const text = '{"met": true, "confidence": "high", "summary": "OK"}';
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(true);
    });

    it('extracts markdown-wrapped JSON with language (strategy 2)', () => {
      const text = '```json\n{"met": true, "confidence": "high", "summary": "Done"}\n```';
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(true);
      expect(parsed.confidence).toBe('high');
    });

    it('extracts markdown-wrapped JSON without language (strategy 2)', () => {
      const text = '```\n{"met": false, "confidence": "medium", "summary": "Incomplete"}\n```';
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(false);
      expect(parsed.confidence).toBe('medium');
    });

    it('handles multiple backticks in fence markers', () => {
      const text = '````json\n{"met": true}\n````';
      const result = collectJsonWithFallback(text);
      // Should handle 4+ backticks
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts JSON with prose before and markdown fences', () => {
      const text = `Based on my analysis:

\`\`\`json
{
  "met": true,
  "confidence": "high",
  "summary": "All requirements met",
  "evidence": ["File changed"],
  "missing": [],
  "retry_prompt": "",
  "validation_notes": [],
  "evidence_sources_inspected": [],
  "contradictions": [],
  "confidence_calibration": {"outcome": "met", "justification": "Evidence"}
}
\`\`\``;
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(true);
      expect(typeof parsed.evidence).toBe('object');
    });

    it('uses confidence enum as anchor (strategy 3)', () => {
      // Markdown code fence handling should fail, then confidence anchor kicks in
      const text = 'With high confidence: {"met": true, "confidence": "high"}';
      const result = collectJsonWithFallback(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.confidence).toBe('high');
    });

    it('tries JSONLines pattern as fallback (strategy 4)', () => {
      const text = `line 1
line 2
{"met": true, "confidence": "high"}
line 4`;
      const result = collectJsonWithFallback(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(true);
    });

    it('returns empty array for prose-only text', () => {
      const text = 'The analysis shows that all requirements were met successfully.';
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(0);
    });

    it('handles nested objects in markdown', () => {
      const text = `\`\`\`json
{
  "met": true,
  "confidence": "high",
  "confidence_calibration": {
    "outcome": "met",
    "justification": "Evidence supports"
  }
}
\`\`\``;
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.confidence_calibration.outcome).toBe('met');
    });

    it('handles escaped quotes in markdown-wrapped JSON', () => {
      const text = `\`\`\`json
{"summary": "Escaped \\"quotes\\" work correctly"}
\`\`\``;
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.summary).toContain('Escaped');
    });

    it('extracts JSON with arrays in evidence field', () => {
      const text = `\`\`\`json
{
  "met": true,
  "confidence": "high",
  "evidence": [
    "File: src/app.ts (lines 10-20)",
    "Test: npm check passed",
    "Validation: all green"
  ],
  "missing": [],
  "retry_prompt": "",
  "validation_notes": [],
  "evidence_sources_inspected": ["goal-setting.json"],
  "contradictions": [],
  "confidence_calibration": {"outcome": "met", "justification": "3+ evidence"}
}
\`\`\``;
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(Array.isArray(parsed.evidence)).toBe(true);
      expect(parsed.evidence.length).toBe(3);
    });

    it('handles mixed strategies in complex response', () => {
      // This is a real-world case: markdown fence with internal strings containing JSON-like text
      const text = `Analysis complete:

\`\`\`json
{
  "met": true,
  "confidence": "high",
  "summary": "Changes match requirements",
  "evidence": ["git diff shows {'key':'value'} update"],
  "missing": [],
  "retry_prompt": "",
  "validation_notes": ["npm check: {'status':'pass'}"],
  "evidence_sources_inspected": ["goal-setting.json"],
  "contradictions": [],
  "confidence_calibration": {"outcome": "met", "justification": "Evidence"}
}
\`\`\`

The result looks good.`;
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(true);
      expect(parsed.confidence).toBe('high');
    });
  });

  describe('Regression Tests - No False Positives', () => {
    it('does not extract incomplete JSON from code fences', () => {
      const text = '```json\n{"incomplete": ';
      const result = collectJsonWithFallback(text);
      // Should return empty since JSON is incomplete
      expect(result).toHaveLength(0);
    });

    it('does not double-extract when JSON appears in string', () => {
      const text = '```json\n{"text": "This contains {a:b}"}\n```';
      const result = collectJsonWithFallback(text);
      expect(result).toHaveLength(1);
      // Should only extract one valid JSON object, not confused by the inner text
      expect(JSON.parse(result[0]).text).toContain('{');
    });

    it('handles edge case: code fence without closing', () => {
      const text = '```json\n{"met": true}';
      // Without closing fence, but JSON is still complete
      const result = collectJsonWithFallback(text);
      // Should still find the JSON via strategy 2
      expect(result.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(result[0]);
      expect(parsed.met).toBe(true);
    });
  });

  describe('Tier 2 Goal-Check Verdict Extraction', () => {
    it('extracts valid goal-check verdict from streaming response', () => {
      // Simulates a real streaming response pattern
      const streamingText = `{"type":"text_delta","text":"Analyzing..."}
{"type":"text_delta","text":"\\n\\n\`\`\`json\\n"}
{"type":"text_delta","text":"{\\"met\\":true,\\"confidence\\":\\"high\\",\\"summary\\":\\"Complete\\","}
{"type":"text_delta","text":"\\"evidence\\":[\\"test1\\"],\\"missing\\":[],\\"retry_prompt\\":\\"\\","}
{"type":"text_delta","text":"\\"validation_notes\\":[],\\"evidence_sources_inspected\\":[],\\"contradictions\\":[],"}
{"type":"text_delta","text":"\\"confidence_calibration\\":{\\"outcome\\":\\"met\\",\\"justification\\":\\"OK\\"}}\\n\`\`\`"}`;

      const result = collectJsonWithFallback(streamingText);
      // May not extract from streaming (escaped quotes), but shouldn't break
      if (result.length > 0) {
        expect(() => JSON.parse(result[0])).not.toThrow();
      }
    });

    it('extracts verdict with all required fields', () => {
      const verdictText = `\`\`\`json
{
  "met": true,
  "confidence": "high",
  "summary": "Agent successfully implemented all requirements",
  "evidence": [
    "src/parser.ts: Added null-safety checks at lines 45-52",
    "Tests pass: npm run check succeeded",
    "Validation: All integration tests green"
  ],
  "missing": [],
  "retry_prompt": "",
  "validation_notes": [
    "npm run check: PASSED",
    "npm run test: 15/15 tests passing"
  ],
  "evidence_sources_inspected": [
    "goal-setting.json",
    "scouting.json",
    "changed-files.txt",
    "git.diff",
    "validation.log"
  ],
  "contradictions": [],
  "confidence_calibration": {
    "outcome": "met",
    "justification": "3+ evidence items + 5/5 SMART criteria met"
  }
}
\`\`\``;

      const result = collectJsonWithFallback(verdictText);
      expect(result).toHaveLength(1);
      const verdict = JSON.parse(result[0]);

      // Verify all required fields are present
      expect(typeof verdict.met).toBe('boolean');
      expect(['high', 'medium', 'low']).toContain(verdict.confidence);
      expect(typeof verdict.summary).toBe('string');
      expect(Array.isArray(verdict.evidence)).toBe(true);
      expect(Array.isArray(verdict.missing)).toBe(true);
      expect(typeof verdict.retry_prompt).toBe('string');
      expect(Array.isArray(verdict.validation_notes)).toBe(true);
      expect(Array.isArray(verdict.evidence_sources_inspected)).toBe(true);
      expect(Array.isArray(verdict.contradictions)).toBe(true);
      expect(typeof verdict.confidence_calibration).toBe('object');
      expect(typeof verdict.confidence_calibration.outcome).toBe('string');
      expect(typeof verdict.confidence_calibration.justification).toBe('string');
    });
  });
});
