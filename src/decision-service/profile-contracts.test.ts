import { describe, expect, it } from '@jest/globals';
import {
  PROFILE_ANSWER_CONTRACTS,
  profileAnswerContracts,
  SENKU_PROFILE_IDS,
} from './profile-contracts';
import artifact from './senku-profiles.v1.json';

describe('pinned Senku profile contracts', () => {
  it('keeps the Kaseki profile registry aligned with the response-only artifact', () => {
    expect(artifact.profiles.filter((profile) => profile.allowedClients.includes('kaseki')).map((profile) => profile.id).sort())
      .toEqual([...SENKU_PROFILE_IDS].sort());
    expect(Object.keys(PROFILE_ANSWER_CONTRACTS).sort()).toEqual([...SENKU_PROFILE_IDS].sort());
    expect(PROFILE_ANSWER_CONTRACTS.task_admission_v1.risk_level)
      .toEqual({ type: 'choice', choices: ['low', 'review', 'high'] });
    expect(PROFILE_ANSWER_CONTRACTS.validation_recovery_v1.validation_recovery_action)
      .toEqual({ type: 'choice', choices: ['fix_implementation', 'repair_environment', 'retry_validation_once', 'inspect_diagnostics'] });
  });

  it('uses the pinned dynamic variants for goal, run, and context answers', () => {
    expect(profileAnswerContracts('kaseki_goal_check_v1', {
      criteria: [{ id: 'criterion_12', appliesWhen: 'When relevant.' }],
    })).toEqual({
      criterion_12_applicability: { type: 'choice', choices: ['applicable', 'not_applicable', 'unknown'] },
      criterion_12: { type: 'noul' },
    });
    expect(profileAnswerContracts('kaseki_run_evaluation_v1', { includeFailureDiagnosis: true }))
      .toHaveProperty('task_completion_score', { type: 'score', levels: 5 });
    expect(profileAnswerContracts('kaseki_context_routing_v1', {
      mode: 'tool_output', evidence: {},
    })).toEqual({ route: { type: 'choice', choices: ['preserve', 'compact_repeated', 'structural_code'] } });
    expect(profileAnswerContracts('kaseki_context_routing_v1', {
      mode: 'phase_transfer', evidence: { candidates: [{ id: 'file_4' }, { id: 'test_19' }] },
    })).toEqual({
      file_4: { type: 'choice', choices: ['preserve', 'condense', 'discard'] },
      test_19: { type: 'choice', choices: ['preserve', 'condense', 'discard'] },
    });
  });
});
