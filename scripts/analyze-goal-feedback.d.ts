#!/usr/bin/env node
/**
 * Analyze goal-setting feedback across multiple runs
 *
 * Usage:
 *   node analyze-goal-feedback.js [feedback_file]
 *
 * Reads JSONL feedback entries and produces analysis report showing:
 * - Correlation between goal quality and success rate
 * - SMART dimension effectiveness
 * - Kaseki improvement suggestions by priority
 *
 * Default: reads /results/goal-feedback.jsonl
 */
interface FeedbackEntry {
    phase?: string;
    goal_quality?: Record<string, unknown>;
    goal_check_verdict?: Record<string, unknown>;
    correlation?: Record<string, unknown>;
    outcomes?: Record<string, unknown>;
    [key: string]: unknown;
}
interface BucketStats {
    count: number;
    success_rate: string;
    verdict_met_rate: string;
    avg_quality_score: string;
    avg_completion_attempts: string;
}
interface BucketData {
    [key: string]: BucketStats;
}
interface SmartAnalysis {
    total_criteria: number;
    distribution: Record<string, string>;
    insight: string;
}
interface Recommendation {
    priority: string;
    area: string;
    recommendation: string;
}
interface Analysis {
    total_runs: number;
    message?: string;
    quality_buckets?: BucketData;
    correlation_insights?: string[];
    smart_analysis?: SmartAnalysis;
    recommendations?: Recommendation[];
}
declare function readFeedbackFile(filePath: string): FeedbackEntry[];
declare function analyzeGoalFeedback(entries: FeedbackEntry[]): Analysis;
declare function analyzeCorrelations(entries: FeedbackEntry[]): string[];
declare function analyzeSmartDimensions(entries: FeedbackEntry[]): SmartAnalysis;
declare function generateRecommendations(stats: BucketData, correlationNotes: string[], smartAnalysis: SmartAnalysis): Recommendation[];
export { readFeedbackFile, analyzeGoalFeedback, analyzeCorrelations, analyzeSmartDimensions, generateRecommendations };
//# sourceMappingURL=analyze-goal-feedback.d.ts.map