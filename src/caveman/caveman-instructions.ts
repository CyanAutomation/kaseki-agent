/**
 * Caveman Communication Mode Instruction Library
 *
 * Implements the Caveman skill (https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman/SKILL.md)
 * for kaseki-agent.
 *
 * This library provides terse communication instructions following Caveman skill rules:
 * - Drop articles (a/an/the), filler (just/really/basically), pleasantries (sure/certainly)
 * - Lite intensity: keep full sentences and grammar structure, professional but tight
 * - Preserve technical terms, code blocks, and error strings exactly
 * - Never announce or self-reference the mode
 * - Model pattern: [thing] [action] [reason]. [next step].
 */

/**
 * Caveman lite intensity instruction text.
 * Professional but tight: drop articles/filler, keep full sentences.
 */
const CAVEMAN_INSTRUCTION_LITE = `Terse, professional communication. Drop articles, filler, pleasantries. Keep full sentences. Short synonyms (big not extensive, fix not implement). No tool narration, tables, emoji. Standard acronyms only (DB/API/HTTP). Technical terms exact, code blocks unchanged. Pattern: [thing] [action] [reason]. [next step]. Example: "Bug in auth middleware. Expiry check uses < not <=. Fix:" Substance stays. Fluff dies.`;

/**
 * Get Caveman instruction text for kaseki-agent phases.
 *
 * @returns The Caveman lite instruction string for prompt injection.
 *
 * Usage in prompts:
 *   ```bash
 *   CAVEMAN_INSTRUCTION="$(get_caveman_instruction)"
 *   printf '%s\n\n%s' "$CAVEMAN_INSTRUCTION" "$MAIN_PROMPT"
 *   ```
 */
export function getCavemanInstruction(): string {
  return CAVEMAN_INSTRUCTION_LITE;
}
