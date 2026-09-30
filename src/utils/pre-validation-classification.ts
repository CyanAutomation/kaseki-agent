/**
 * Shared classification for the pre-agent validation stage.
 *
 * metadata.failed_command can name the pre-agent validation stage in several
 * forms (space/underscore/hyphen separators, arbitrary casing). One predicate
 * keeps the naming rule in a single place so the status helpers cannot drift.
 */
const PRE_AGENT_VALIDATION_PATTERN = /pre[-_ ]agent validation|pre[-_ ]validation/;

export function isPreAgentValidationFailedCommand(command: string): boolean {
  return PRE_AGENT_VALIDATION_PATTERN.test(command.toLowerCase());
}
