/** Types for the structured decision endpoint. */
export type QuestionType = 'noul' | 'choice' | 'score';
export type JevContent = string | Record<string, unknown> | unknown[];

interface BaseQuestion { instructions: JevContent; }
export interface NoulQuestion extends BaseQuestion { type: 'noul'; criteria?: { true?: JevContent; false?: JevContent }; }
export interface ChoiceQuestion extends BaseQuestion { type: 'choice'; criteria: Record<string, JevContent | null>; }
export interface ScoreQuestion extends BaseQuestion { type: 'score'; criteria: JevContent[]; }
export type QuestionDefinition = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer { type: 'noul'; noul: number; probabilities?: { false: number; true: number }; confidence?: null; }
export interface ChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number | null; }
export interface ScoreAnswer { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number | null; }
export type ClassificationAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export interface ClassificationValidationResult { isValid: boolean; failedQuestions: string[]; messages: string[]; }
