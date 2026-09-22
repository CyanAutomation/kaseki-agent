/** Types for OpenRouter's TypeSafe JEV decisions endpoint. */
export type QuestionType = 'noul' | 'choice' | 'score';
export type JevContent = string | Record<string, unknown> | unknown[];

interface BaseQuestion { instructions: JevContent; }
export interface NoulQuestion extends BaseQuestion { type: 'noul'; criteria?: { true?: JevContent; false?: JevContent }; }
export interface ChoiceQuestion extends BaseQuestion { type: 'choice'; criteria: Record<string, JevContent | null>; }
export interface ScoreQuestion extends BaseQuestion { type: 'score'; criteria: JevContent[]; }
export type QuestionDefinition = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer { type: 'noul'; noul: number; }
export interface ChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number; }
export interface ScoreAnswer { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number; }
export type ClassificationAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionsApiRequest { model: string; state: string | Record<string, unknown>; questions: Record<string, QuestionDefinition>; }
export interface DecisionsApiResponse {
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: { prompt_tokens?: number; input_tokens?: number; completion_tokens?: number; output_tokens?: number; total_tokens?: number; cost?: number; };
  id?: string;
  provider?: string;
}
export interface ClassificationValidationResult { isValid: boolean; failedQuestions: string[]; messages: string[]; }
