import profilesArtifact from './senku-profiles.v1.json' with { type: 'json' };

export const SENKU_PROFILE_IDS = [
  'task_admission_v1', 'kaseki_goal_check_v1', 'kaseki_run_evaluation_v1', 'kaseki_context_routing_v1', 'validation_recovery_v1',
] as const;
export type SenkuProfileId = typeof SENKU_PROFILE_IDS[number];

export type ProfileAnswerContract =
  | { type: 'noul' }
  | { type: 'choice'; choices: readonly string[] }
  | { type: 'score'; levels: number };

type JsonRecord = Record<string, unknown>;
type PinnedProfile = (typeof profilesArtifact.profiles)[number];

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function pinnedProfile(profileId: SenkuProfileId): PinnedProfile {
  const profile = profilesArtifact.profiles.find((candidate) => candidate.id === profileId && candidate.allowedClients.includes('kaseki'));
  if (!profile) throw new Error(`Pinned Senku contract is missing Kaseki profile ${profileId}.`);
  return profile;
}

function answerContract(schema: unknown): ProfileAnswerContract {
  const properties = record(record(schema).properties);
  const type = record(properties.type).const;
  if (type === 'noul') return { type: 'noul' };
  if (type === 'choice') {
    const choices = record(properties.choice).enum;
    if (!Array.isArray(choices) || choices.length < 2 || !choices.every((choice) => typeof choice === 'string')) {
      throw new Error('Pinned Senku choice contract is invalid.');
    }
    return { type: 'choice', choices };
  }
  if (type === 'score') {
    const maximum = record(properties.score).maximum;
    if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error('Pinned Senku score contract is invalid.');
    }
    return { type: 'score', levels: maximum + 1 };
  }
  throw new Error('Pinned Senku answer contract has an unsupported answer type.');
}

function contractsFromSchema(schema: unknown): Record<string, ProfileAnswerContract> {
  const properties = record(record(schema).properties);
  return Object.fromEntries(Object.entries(properties).map(([id, answer]) => [id, answerContract(answer)]));
}

const PINNED_IDS = profilesArtifact.profiles
  .filter((profile) => profile.allowedClients.includes('kaseki'))
  .map((profile) => profile.id).sort();
if (JSON.stringify(PINNED_IDS) !== JSON.stringify([...SENKU_PROFILE_IDS].sort())) {
  throw new Error('Kaseki Senku profile IDs differ from the pinned Senku contract artifact.');
}

export const PROFILE_ANSWER_CONTRACTS: Readonly<Record<SenkuProfileId, Readonly<Record<string, ProfileAnswerContract>>>> =
  Object.fromEntries(SENKU_PROFILE_IDS.map((profileId) => [profileId, contractsFromSchema(pinnedProfile(profileId).outputSchema)])) as
    Record<SenkuProfileId, Readonly<Record<string, ProfileAnswerContract>>>;

function variantContracts(profileId: SenkuProfileId, variant: string): Record<string, ProfileAnswerContract> {
  const variants = record(pinnedProfile(profileId).outputVariants);
  if (!variants[variant]) throw new Error(`Pinned Senku contract is missing ${profileId} variant ${variant}.`);
  return contractsFromSchema(variants[variant]);
}

function renameDynamicTemplate(
  template: Record<string, ProfileAnswerContract>,
  templateId: string,
): ProfileAnswerContract {
  const contract = template[templateId];
  if (!contract) throw new Error(`Pinned Senku contract is missing dynamic answer ${templateId}.`);
  return contract;
}

export function profileAnswerContracts(
  profileId: SenkuProfileId,
  input: Record<string, unknown>,
): Record<string, ProfileAnswerContract> {
  if (profileId === 'kaseki_goal_check_v1') {
    if (!Array.isArray(input.criteria)) return {};
    const variant = variantContracts(profileId, 'with_applicability');
    const contracts: Record<string, ProfileAnswerContract> = {};
    for (const item of input.criteria) {
      if (!record(item) || typeof record(item).id !== 'string' || !/^criterion_[1-9][0-9]*$/.test(record(item).id as string)) return {};
      const { id } = record(item) as { id: string };
      if (typeof record(item).appliesWhen === 'string' && (record(item).appliesWhen as string).trim()) {
        contracts[`${id}_applicability`] = renameDynamicTemplate(variant, 'criterion_1_applicability');
      }
      contracts[id] = renameDynamicTemplate(variant, 'criterion_1');
    }
    return contracts;
  }
  if (profileId === 'kaseki_run_evaluation_v1') {
    const contracts = variantContracts(profileId, 'with_failure_diagnosis');
    if (input.includeFailureDiagnosis !== true) {
      delete contracts.validation_failure_cause;
      delete contracts.validation_recovery_action;
    }
    return contracts;
  }
  if (profileId === 'kaseki_context_routing_v1') {
    if (input.mode === 'tool_output') return variantContracts(profileId, 'tool_output');
    if (input.mode === 'semantic_context') return variantContracts(profileId, 'semantic_context');
    if (input.mode === 'phase_transfer' && record(input.evidence) && Array.isArray(record(input.evidence).candidates)) {
      const template = variantContracts(profileId, 'phase_transfer');
      const contracts: Record<string, ProfileAnswerContract> = {};
      for (const item of record(input.evidence).candidates as unknown[]) {
        const candidate = record(item);
        if (typeof candidate.id !== 'string' || !/^(?:file|observation|plan|test)_[0-9]+$/.test(candidate.id)) return {};
        const family = candidate.id.replace(/_[0-9]+$/, '');
        const templateId = `${family}_0`;
        contracts[candidate.id] = renameDynamicTemplate(template, templateId);
      }
      return contracts;
    }
    return {};
  }
  return { ...PROFILE_ANSWER_CONTRACTS[profileId] };
}
