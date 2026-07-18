/**
 * Gateway Response Validation & Analysis
 *
 * Compatibility facade for gateway response parsing and event structure
 * diagnostics. Keep these exports stable for existing smoke tests and routes.
 */

export {
  extractOutputTokens,
  parseResponsesSse,
} from './gateway-response-parsing.js';

export {
  analyzeMessageFields,
  analyzeResponseStructure,
  buildSuggestedPatterns,
  countPiJsonEvents,
  extractSampleEventStructure,
} from './gateway-response-structure.js';
