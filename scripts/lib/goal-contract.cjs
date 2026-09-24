'use strict';

const NO_CHANGE_PATTERN = /\b(?:zero|no|without)\s+(?:any\s+)?(?:(?:code|file|source|repository|repo)\s+)?(?:changes?|diffs?|modifications?)\b(?!\s+(?:to|outside|beyond|except(?:\s+for)?|other\s+than)\b)|\bship\s+(?:zero|no)\s+(?:code\s+)?changes?\b|\b(?:leave|keep)\s+(?:the\s+)?(?:code|repository|repo)\s+unchanged\b/i;
const CONDITIONAL_PATTERN = /\b(?:if|unless|when|otherwise)\b/i;
const OUTCOME_POLICIES = new Set(['change_required', 'change_or_noop']);

function normalizeSuccessCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];
  return criteria.flatMap((item, index) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ id: `criterion_${index + 1}`, criterion: item.trim() }];
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const criterion = typeof item.criterion === 'string' ? item.criterion.trim() : '';
    if (!criterion) return [];
    const appliesWhen = typeof item.applies_when === 'string'
      ? item.applies_when.trim()
      : typeof item.appliesWhen === 'string' ? item.appliesWhen.trim() : '';
    return [{
      id: `criterion_${index + 1}`,
      criterion,
      ...(appliesWhen ? { appliesWhen } : {}),
    }];
  });
}

function validateGoalContract(goal, options = {}) {
  const errors = [];
  const warnings = [];
  const requireOutcomePolicy = options.requireOutcomePolicy === true;
  const outcomePolicy = goal && typeof goal === 'object' ? goal.outcome_policy : undefined;
  const criteria = normalizeSuccessCriteria(goal && typeof goal === 'object' ? goal.success_criteria : undefined);

  if (!OUTCOME_POLICIES.has(outcomePolicy)) {
    if (requireOutcomePolicy || outcomePolicy !== undefined) {
      errors.push('outcome_policy must be change_required or change_or_noop');
    } else {
      warnings.push('outcome_policy is missing; downstream checks will use the task-mode default');
    }
  }
  if (criteria.length === 0) errors.push('success_criteria must contain at least one non-empty criterion');

  criteria.forEach((item, index) => {
    if (CONDITIONAL_PATTERN.test(item.criterion) && !item.appliesWhen) {
      errors.push(`success_criteria[${index}] is conditional and must declare applies_when`);
    }
    if (outcomePolicy === 'change_required' && NO_CHANGE_PATTERN.test(item.criterion)) {
      errors.push(`success_criteria[${index}] conflicts with outcome_policy=change_required because it requires no code changes`);
    }
  });

  return { valid: errors.length === 0, outcomePolicy, criteria, errors, warnings };
}

module.exports = { normalizeSuccessCriteria, validateGoalContract };
