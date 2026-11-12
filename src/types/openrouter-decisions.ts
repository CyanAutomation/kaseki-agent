/** Answer shapes shared by Kaseki's profile-based Senku client and local reports. */
export interface NoulAnswer { type: 'noul'; noul: number; probabilities?: { false: number; true: number }; confidence?: null; }
export interface ChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number | null; }
export interface ScoreAnswer { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number | null; }
export type ClassificationAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export interface ClassificationValidationResult { isValid: boolean; failedQuestions: string[]; messages: string[]; }
