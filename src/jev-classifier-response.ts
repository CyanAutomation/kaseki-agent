import type { ClassificationAnswer, DecisionsApiResponse, QuestionDefinition } from './types/openrouter-decisions';

interface ParsedJevClassificationResponse {
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
  attemptCount: number;
}

function isProbability(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function isDistribution(value: unknown, expectedKeys: string[]): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const distribution = value as Record<string, unknown>;
  const keys = Object.keys(distribution);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => Object.hasOwn(distribution, key)) || !Object.values(distribution).every(isProbability)) return false;
  const total = Object.values(distribution).reduce<number>((sum, probability) => sum + Number(probability), 0);
  return Math.abs(total - 1) <= 0.03;
}

function validNoulAnswer(value: Record<string, unknown>): boolean {
  return value.type === 'noul' && isProbability(value.noul);
}

function validChoiceAnswer(question: Extract<QuestionDefinition, { type: 'choice' }>, value: Record<string, unknown>): boolean {
  const keys = Object.keys(question.criteria);
  return value.type === 'choice'
    && typeof value.choice === 'string'
    && keys.includes(value.choice)
    && isDistribution(value.probabilities, keys)
    && isProbability(value.confidence);
}

function validScoreAnswer(question: Extract<QuestionDefinition, { type: 'score' }>, value: Record<string, unknown>): boolean {
  const scoreKeys = question.criteria.map((_, index) => String(index));
  const validScore = value.type === 'score'
    && typeof value.score === 'number'
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= question.criteria.length - 1
    && isDistribution(value.probabilities, scoreKeys)
    && isProbability(value.confidence);
  if (!validScore || !value.legend || typeof value.legend !== 'object' || Array.isArray(value.legend)) return false;
  const legend = value.legend as Record<string, unknown>;
  return Object.keys(legend).length === scoreKeys.length && scoreKeys.every((key) => typeof legend[key] === 'string');
}

function validAnswer(question: QuestionDefinition, answer: unknown): answer is ClassificationAnswer {
  if (!answer || typeof answer !== 'object') return false;
  const value = answer as Record<string, unknown>;
  if (question.type === 'noul') return validNoulAnswer(value);
  if (question.type === 'choice') return validChoiceAnswer(question, value);
  return validScoreAnswer(question, value);
}
export function parseResponse(
  value: unknown,
  questions: Record<string, QuestionDefinition>,
  defaultModel: string,
): ParsedJevClassificationResponse | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Partial<DecisionsApiResponse>;
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return null;
  const answers = body.answers;
  const ids = Object.keys(questions);
  if (Object.keys(answers).length !== ids.length || !ids.every((id) => validAnswer(questions[id], answers[id]))) return null;
  return { model: typeof body.model === 'string' ? body.model : defaultModel, answers, usage: body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {}, responseTime: 0, attemptCount: 0 };
}
