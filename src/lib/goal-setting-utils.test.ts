import { detectPlaceholders, hasPlaceholders, createFallbackGoalSettingArtifact, isValidGoalSettingArtifact } from './goal-setting-utils';
import { GoalSettingOutput } from '../types/goal-setting';

describe('goal-setting-utils', () => {
  describe('detectPlaceholders', () => {
    test('should find placeholder in original_prompt', () => {
      const artifact = {
        original_prompt: 'the original user prompt',
        upgraded_goal: 'real goal',
        reasoning: 'real reasoning',
        key_requirements: [],
        success_criteria: [],
        confidence: 'high',
      };
      const found = detectPlaceholders(artifact);
      expect(found.length).toBeGreaterThan(0);
      expect(found.some((p) => p.includes('original user prompt'))).toBe(true);
    });

    test('should find multiple placeholders', () => {
      const artifact = {
        original_prompt: 'the original user prompt',
        upgraded_goal: 'concise goal (1-3 sentences), actionable for a coding agent',
        reasoning: 'real reasoning',
        key_requirements: [],
        success_criteria: [
          {
            criterion: 'specific, measurable criterion',
            smart_score: 'high',
            reasoning: 'test',
          },
        ],
        confidence: 'high',
      };
      const found = detectPlaceholders(artifact);
      expect(found.length).toBeGreaterThanOrEqual(2);
      expect(found.some((p) => p.includes('original user prompt'))).toBe(true);
      expect(found.some((p) => p.includes('1-3 sentences'))).toBe(true);
    });

    test('should find path pattern placeholders', () => {
      const artifact = {
        original_prompt: 'real prompt',
        upgraded_goal: 'real goal',
        reasoning: 'real reasoning',
        key_requirements: [],
        success_criteria: [],
        anti_patterns: {
          do_not_modify: ['path/pattern1/**', 'path/pattern2/**'],
        },
        confidence: 'high',
      };
      const found = detectPlaceholders(artifact);
      expect(found.length).toBeGreaterThan(0);
      expect(found.some((p) => p.includes('pattern'))).toBe(true);
    });

    test('should find constraint placeholders', () => {
      const artifact = {
        original_prompt: 'real prompt',
        upgraded_goal: 'real goal',
        reasoning: 'real reasoning',
        key_requirements: [],
        success_criteria: [],
        constraints: {
          operational: ['e.g., max 3 files changed'],
          architectural: ['e.g., respect service boundaries'],
          technical: ['e.g., must pass type checking'],
          business: ['e.g., maintain user-facing behavior'],
        },
        confidence: 'high',
      };
      const found = detectPlaceholders(artifact);
      expect(found.length).toBeGreaterThanOrEqual(4);
    });

    test('should return empty array for valid artifact', () => {
      const artifact: GoalSettingOutput = {
        original_prompt: 'Fix null-safety in parseRole() function',
        upgraded_goal: 'Add null-safety checks to parseRole() and cover with tests',
        reasoning: 'Function currently crashes on null input',
        key_requirements: ['Must pass type checking', 'All tests must pass'],
        success_criteria: [
          {
            criterion: 'parseRole(null) returns undefined instead of crashing',
            smart_score: 'high',
            reasoning: 'Directly addresses null-safety',
          },
        ],
        constraints: {
          operational: ['Change only src/lib/parser.ts'],
          technical: ['Must pass type checking'],
        },
        confidence: 'high',
      };
      const found = detectPlaceholders(artifact);
      expect(found).toHaveLength(0);
    });

    test('should find placeholder in JSON-stringified artifact', () => {
      const artifact = {
        original_prompt: 'the original user prompt',
        upgraded_goal: 'real',
        reasoning: 'real',
        key_requirements: [],
        success_criteria: [],
        confidence: 'high',
      };
      const stringified = JSON.stringify(artifact);
      const found = detectPlaceholders(stringified);
      expect(found.length).toBeGreaterThan(0);
    });
  });

  describe('hasPlaceholders', () => {
    test('should return true when placeholders present', () => {
      const artifact = {
        original_prompt: 'the original user prompt',
        upgraded_goal: 'real',
        reasoning: 'real',
        key_requirements: [],
        success_criteria: [],
        confidence: 'high',
      };
      expect(hasPlaceholders(artifact)).toBe(true);
    });

    test('should return false when no placeholders', () => {
      const artifact: GoalSettingOutput = {
        original_prompt: 'Fix parseRole null-safety',
        upgraded_goal: 'Add null checks to parseRole()',
        reasoning: 'Function crashes on null',
        key_requirements: [],
        success_criteria: [
          {
            criterion: 'parseRole(null) returns safely',
            smart_score: 'high',
          },
        ],
        confidence: 'high',
      };
      expect(hasPlaceholders(artifact)).toBe(false);
    });

    test('should handle objects and strings', () => {
      const obj = { original_prompt: 'the original user prompt' };
      const str = JSON.stringify(obj);
      expect(hasPlaceholders(obj)).toBe(true);
      expect(hasPlaceholders(str)).toBe(true);
    });
  });

  describe('createFallbackGoalSettingArtifact', () => {
    test('should create valid artifact with confidence=low', () => {
      const taskPrompt = 'Fix null-safety in parseRole()';
      const artifact = createFallbackGoalSettingArtifact(taskPrompt);

      expect(artifact).toBeDefined();
      expect(artifact.original_prompt).toBe(taskPrompt);
      expect(artifact.confidence).toBe('low');
      expect(hasPlaceholders(artifact)).toBe(false);
    });

    test('should have all required fields', () => {
      const taskPrompt = 'Update error handling';
      const artifact = createFallbackGoalSettingArtifact(taskPrompt);

      expect(artifact).toHaveProperty('original_prompt');
      expect(artifact).toHaveProperty('upgraded_goal');
      expect(artifact).toHaveProperty('key_requirements');
      expect(artifact).toHaveProperty('success_criteria');
      expect(artifact).toHaveProperty('reasoning');
      expect(artifact).toHaveProperty('confidence');
    });

    test('should create success criteria with valid SMART score', () => {
      const taskPrompt = 'Add tests for edge cases';
      const artifact = createFallbackGoalSettingArtifact(taskPrompt);

      expect(artifact.success_criteria.length).toBeGreaterThan(0);
      const criterion = artifact.success_criteria[0];
      if (typeof criterion === 'object' && 'smart_score' in criterion) {
        expect(['high', 'medium', 'low']).toContain(criterion.smart_score);
      }
    });

    test('should indicate fallback in reasoning', () => {
      const taskPrompt = 'Some task';
      const artifact = createFallbackGoalSettingArtifact(taskPrompt);
      expect(artifact.reasoning.toLowerCase()).toContain('fallback');
    });

    test('should handle long task prompts', () => {
      const longPrompt = 'Fix null-safety in parseRole() function which handles user input and should validate before processing';
      const artifact = createFallbackGoalSettingArtifact(longPrompt);
      expect(artifact.original_prompt).toBe(longPrompt);
      expect(artifact.upgraded_goal).toBeTruthy();
    });

    test('should have valid constraint structure', () => {
      const taskPrompt = 'Fix parser bug';
      const artifact = createFallbackGoalSettingArtifact(taskPrompt);
      expect(artifact.constraints).toBeDefined();
      if (artifact.constraints) {
        expect(Array.isArray(artifact.constraints.operational) || artifact.constraints.operational === undefined).toBe(true);
        expect(Array.isArray(artifact.constraints.technical) || artifact.constraints.technical === undefined).toBe(true);
      }
    });
  });

  describe('isValidGoalSettingArtifact', () => {
    test('should validate proper artifact', () => {
      const artifact: GoalSettingOutput = {
        original_prompt: 'Fix parser',
        upgraded_goal: 'Fix parser null checks',
        reasoning: 'Parser crashes on null',
        key_requirements: ['Pass tests'],
        success_criteria: [{ criterion: 'No crashes', smart_score: 'high' }],
        confidence: 'high',
      };
      expect(isValidGoalSettingArtifact(artifact)).toBe(true);
    });

    test('should reject artifact with placeholder content', () => {
      const artifact = {
        original_prompt: 'the original user prompt',
        upgraded_goal: 'real goal',
        reasoning: 'real',
        key_requirements: [],
        success_criteria: [],
        confidence: 'high',
      };
      expect(isValidGoalSettingArtifact(artifact)).toBe(false);
    });

    test('should reject artifact missing required fields', () => {
      const artifact = {
        original_prompt: 'Fix parser',
        // missing upgraded_goal
        reasoning: 'real',
        key_requirements: [],
        success_criteria: [],
        confidence: 'high',
      };
      expect(isValidGoalSettingArtifact(artifact)).toBe(false);
    });

    test('should reject artifact with invalid confidence', () => {
      const artifact = {
        original_prompt: 'Fix parser',
        upgraded_goal: 'Fix parser null checks',
        reasoning: 'real',
        key_requirements: [],
        success_criteria: [],
        confidence: 'super_high', // invalid
      };
      expect(isValidGoalSettingArtifact(artifact)).toBe(false);
    });
  });
});
