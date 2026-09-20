/**
 * Type definitions for OpenRouter /api/alpha/decisions API
 * Used by kaseki-agent's classification smoke test for evaluating code review scenarios
 */

/**
 * Represents a single evaluation question used by an AI agent classification workflow.
 * These questions are used to assess a model's decision quality against a given state.
 */
export type QuestionType = 'noul' | 'choice' | 'score';

export interface QuestionDefinition {
  /**
   * Stable identifier for the question within a decision set.
   */
  id?: string;

  /**
   * Human-readable prompt that the model is asked to evaluate.
   */
  instructions?: string;

  /**
   * The question mode:
   * - 'noul': boolean/no-or-unclear response
   * - 'choice': single selection from predefined options
   * - 'score': numeric rating using a score scale
   */
  type: QuestionType;

  /**
   * Optional answer choices for choice-based questions.
   */
  choices?: string[];

  /**
   * Optional criteria or descriptions for choice-based questions.
   */
  criteria?: Record<string, string> | string[];

  /**
   * Optional minimum value for score-based questions.
   */
  min?: number;

  /**
   * Optional maximum value for score-based questions.
   */
  max?: number;

  /**
   * Optional legend mapping score values or labels to descriptive text.
   */
  legend?: Record<string, string | number>;
}

/**
 * A classification result returned for a single question during AI agent evaluation.
 * This captures the model's chosen answer along with confidence and probability metadata.
 */
export interface ClassificationAnswer {
  /**
   * The type of answer returned by the model.
   */
  type?: QuestionType;

  /**
   * The concrete answer value chosen by the model.
   * For choice questions this is a label; for score questions this is a numeric value.
   */
  answer?: string | number | null;

  /**
   * Optional probability distribution across possible outputs.
   */
  probabilities?: Record<string, number>;

  /**
   * Confidence score assigned to the answer by the model or evaluator.
   */
  confidence?: number;

  /**
   * Optional legend used to interpret score values for score-based answers.
   */
  legend?: Record<string, string | number>;

  /**
   * Question identifier (kaseki-agent uses this for routing decisions)
   */
  question?: string;

  /**
   * Reasoning/explanation for the answer
   */
  rationale?: string;
}

/**
 * Request payload for the OpenRouter /api/alpha/decisions endpoint.
 * This body describes the model, the current evaluation state, and the questions to be answered.
 */
export interface DecisionsApiRequest {
  /**
   * Model identifier to use for the decision evaluation.
   */
  model: string;

  /**
   * Structured state/context passed to the model for evaluation.
   */
  state: string | Record<string, unknown>;

  /**
   * The set of evaluation questions that define the decision task.
   */
  questions: Record<string, QuestionDefinition>;
}

/**
 * Response payload returned by the OpenRouter decision API for an evaluation run.
 * This represents the model's answers and associated metadata for an agent assessment.
 */
export interface DecisionsApiResponse {
  /**
   * The model used to generate the decision responses.
   */
  model: string;

  /**
   * The list of answers returned for the requested questions.
   */
  answers: Record<string, ClassificationAnswer>;

  /**
   * Token usage statistics for the evaluation request.
   */
  usage: {
    prompt_tokens?: number;
    input_tokens?: number;
    completion_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };

  /**
   * Unique request or response identifier.
   */
  id?: string;

  /**
   * Provider responsible for serving the model response.
   */
  provider?: string;

  /**
   * Timestamp of the response
   */
  created?: number;

  /**
   * Optional error details if the API returned an error response
   */
  error?: {
    message?: string;
    code?: string | number;
    type?: string;
  };
}

/**
 * Validation result for checking whether a set of classification answers meets evaluation expectations.
 * This is used to verify that an AI agent's decisions are complete and acceptable.
 */
export interface ClassificationValidationResult {
  /**
   * Whether all required questions passed validation.
   */
  isValid: boolean;

  /**
   * The identifiers or labels of questions that failed validation.
   */
  failedQuestions: string[];

  /**
   * Human-readable messages clarifying validation issues.
   */
  messages: string[];
}
