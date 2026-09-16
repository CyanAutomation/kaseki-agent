import type { ScorecardConfig } from './run-scorecard-config';

/**
 * Thread-safe singleton context for ScorecardConfig.
 * Eliminates parameter threading through 4 function layers (CLI → scoring → dimensions → efficiency).
 * Initialize once in CLI entry point; all scoring functions access via getConfig().
 */
class ScorecardContextImpl {
  private config: ScorecardConfig | null = null;

  initialize(config: ScorecardConfig): void {
    if (this.config !== null) {
      throw new Error('ScorecardContext already initialized; call reset() first');
    }
    this.config = config;
  }

  getConfig(): ScorecardConfig {
    if (this.config === null) {
      throw new Error('ScorecardContext not initialized; call initialize(config) first');
    }
    return this.config;
  }

  reset(): void {
    this.config = null;
  }

  isInitialized(): boolean {
    return this.config !== null;
  }
}

export const ScorecardContext = new ScorecardContextImpl();
