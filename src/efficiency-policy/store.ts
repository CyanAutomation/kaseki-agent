import * as fs from 'fs';
import * as path from 'path';
import { emptyAggregate, updateAggregate } from './aggregate';
import type { AggregateBucket, RunEfficiencyEvidence } from './types';

/** Stores only coarse class/model counters; prompts and requirement text are never persisted. */
export class EfficiencyPolicyStore {
  constructor(private readonly filePath: string) {}

  record(run: RunEfficiencyEvidence): AggregateBucket {
    let all: Record<string, AggregateBucket> = {};
    try {
      const stored: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      // JSON primitives and arrays are valid JSON, but not valid policy stores.
      // Treat them like a corrupt cache instead of dereferencing a null value below.
      if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
        all = stored as Record<string, AggregateBucket>;
      }
    } catch { /* first sample or corrupt cache */ }
    const key = `${run.taskClass}:${run.model}`;
    const updated = updateAggregate(all[key] ?? emptyAggregate(run.taskClass, run.model), run);
    all[key] = updated;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return updated;
  }
}
