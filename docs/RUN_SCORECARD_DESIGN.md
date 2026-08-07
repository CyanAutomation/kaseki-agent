# Run scorecard design

## Purpose and compatibility

`RunScorecard` is the durable, machine-readable assessment of one Kaseki run. The TypeScript and Zod contract is in `src/types/run-scorecard.ts`. Producers MUST validate the object before publishing it and consumers MUST reject an unknown `schema_version`; `rubric_version` identifies scoring semantics independently. Version 1 uses `schema_version: "1.0.0"` and `rubric_version: "2026-08-07"`.

The scorecard records run identity, lifecycle and ISO-8601 timestamps; the score, grade, evidence coverage, confidence and completeness; dimensions; all six phases; token and timing totals; warnings; and the complete scoring configuration. `scoring_config` is data, not a pointer to mutable defaults, so a historical result can always be reproduced.

## Required dimensions and weights

| Dimension (`id`) | Base weight | Primary phase | Score components |
| --- | ---: | --- | --- |
| `goal_quality` | 15% | goal-setting | 50% measurable acceptance criteria, 30% scope precision, 20% constraint coverage |
| `scouting_quality` | 10% | scouting | 40% relevant-file recall, 30% test-impact identification, 30% risk identification |
| `implementation_quality` | 30% | coding | 50% diff conformance to goal, 30% maintainability review, 20% change focus |
| `validation_quality` | 25% | validation | 60% required checks passing, 25% relevant checks executed, 15% regression/baseline handling |
| `goal_attainment` | 15% | goal-check | 70% acceptance criteria met, 30% critical-change expectations met |
| `evaluation_quality` | 5% | run-evaluation | 60% findings supported by evidence, 40% limitations and residual risks recorded |

Each component is first normalized to 0–100, then its component-weighted mean is the dimension's `normalized_score`. `weighted_points = normalized_score × effective_weight`. Before caps, the run score is the sum of weighted points minus reliability penalties, clamped to `[0, 100]`. Values are computed at full precision and serialized rounded to two decimal places.

Every dimension stores its base `weight`, post-eligibility `effective_weight`, raw measurements, normalized score, weighted points, completeness `status`, rationale, evidence references, and warnings. Evidence references identify an artifact and optional locator and SHA-256 digest.

## Normalization functions

The configuration snapshot records the function name, exact expression, and numeric parameters for every component.

* **Binary:** `100` for true/pass and `0` for false/fail.
* **Weighted components:** `sum(component_score × component_weight) / sum(component_weight)`.
* **Positive target ratio:** `100 × clamp(actual / target, 0, 1)`. Use for coverage where more is better.
* **Inverse target ratio:** `100 × clamp(target / actual, 0, 1)`, with `100` when `actual = 0`. Use only as one component of efficiency/change focus, never as the sole measure of quality.
* **Change focus:** `100 × clamp(expected_changed_lines / max(actual_changed_lines, 1), 0, 1)`; reviewers may instead supply a documented 0–100 maintainability/conformance measurement when line counts are misleading.
* **Token efficiency:** `100 × clamp(selected_token_budget / max(measured_tokens, 1), 0, 1)`.
* **Timing efficiency:** `100 × clamp(selected_wall_clock_ms / max(wall_clock_ms, 1), 0, 1)`.

Token or duration efficiency MAY be recorded in raw measurements and MAY contribute to change focus, but together MUST NOT exceed 20% of any dimension. They cannot establish success without diff, validation, and goal evidence.

## Task-size targets

Targets are selected before scoring and copied into `scoring_config.selected_targets` with a rationale. Defaults are guidelines, not universal absolute thresholds:

| Band | Typical change | Token budget | Wall-clock target |
| --- | --- | ---: | ---: |
| `small` | ≤2 files and ≤100 changed lines | 30,000 | 15 minutes |
| `medium` | ≤8 files and ≤500 changed lines | 90,000 | 45 minutes |
| `large` | broader or >500 changed lines | 200,000 | 120 minutes |
| `custom` | generated work, migrations, unusual validation, etc. | explicitly supplied | explicitly supplied |

Classification uses expected scope, not the final diff, to prevent a run from improving its target after overspending. A caller may override any default, but MUST use `custom` or retain the applicable band and explain the override in `rationale`.

Token totals contain input, output, cache-read, cache-write, and unknown tokens. `unavailable: true` means the provider did not report some usage; it is not equivalent to zero. Phase totals use the same shape. Timing includes wall-clock duration plus nullable duration for each named phase; overlapping phase durations need not sum to wall clock.

## Completeness, confidence, phases, and reliability

The same four-state vocabulary is used at run, phase, dimension, and evidence level:

* `complete`: required evidence is present and valid.
* `provisional`: scoreable evidence exists, but it is partial or the run is still active.
* `not_applicable`: an optional phase or measurement was intentionally disabled before the run.
* `unavailable`: applicable evidence is absent, unreadable, or invalid.

Confidence is 0–100 and describes confidence in the score, not execution quality. Start at `100 × evidence_coverage.ratio`, subtract 10 for provisional aggregate token usage and 10 for provisional aggregate timing, then clamp to `[0, 100]`; the rationale explains overrides.

Each of goal-setting, scouting, coding, validation, goal-check, and run-evaluation has an explicit phase measurement. A deliberately disabled optional phase is `enabled: false`, `outcome: skipped`, and `completeness: not_applicable`. Its dimension is ineligible: set its effective weight and weighted points to zero, then redistribute its base weight proportionally among eligible dimensions: `effective_weight_i = base_weight_i / sum(base_weight_eligible)`. The effective weights therefore sum to 1.

An enabled phase that fails, emits an invalid artifact, or omits its required artifact remains eligible with `unavailable` or `provisional` status. It receives **10 penalty points per affected enabled phase**, after weighted points and before caps. This distinguishes operational unreliability from a feature intentionally disabled. The snapshot records the penalty value.

## Evidence coverage, caps, and grades

Required evidence is the set applicable to enabled phases plus the always-required lifecycle metadata, diff, and validation result. `ratio = available / required`. A valid empty diff counts as available evidence but normally produces zero implementation/attainment scores; a missing diff does not.

Apply penalties and then the most restrictive applicable cap:

| Condition | Maximum overall score |
| --- | ---: |
| Diff absent or invalid | 69 |
| Validation result absent or invalid | 59 |
| Both diff and validation absent or invalid | 49 |

Grade is assigned after caps and rounding: **A = 90–100, B = 80–89.99, C = 70–79.99, D = 60–69.99, F = 0–59.99**. The exact bands and caps are duplicated in every configuration snapshot.

## Worked examples

### Successful small change

A two-file, 60-line change selects the small targets (30,000 tokens, 900,000 ms). All phases are enabled and valid. Dimension scores are 95, 90, 92, 96, 94, and 90. Weighted points are `14.25 + 9 + 27.6 + 24 + 14.1 + 4.5 = 93.45`. There are no penalties or caps: **93.45, grade A, complete**. Usage of 22,000 tokens and 540,000 ms supports an efficiency observation but does not replace the passing validation or diff assessment.

### Token-heavy run

A successful small run consumes 75,000 tokens against its preselected 30,000 target, so token efficiency is `100 × 30,000 / 75,000 = 40`. Suppose token efficiency is 20% of implementation's change-focus component, reducing implementation from 92 to 88; other scores remain 95, 90, 96, 94, and 90. The result is `14.25 + 9 + 26.4 + 24 + 14.1 + 4.5 = 92.25`, still **grade A**. The heavy usage is visible and affects the score, but demonstrated correctness dominates.

### Incomplete run

All phases were enabled, but validation failed to produce a valid result and the diff is missing. Dimension scores before reliability are 80, 75, 0, 0, 20, and 40, totaling `12 + 7.5 + 0 + 0 + 3 + 2 = 24.5`. Two affected enabled phases (coding and validation) impose 20 points, yielding 4.5; the combined-evidence cap is 49 and does not further reduce it. The result is **4.5, grade F, unavailable**, with both critical artifacts listed and low confidence.

### Scouting disabled

Scouting is intentionally disabled, so it receives no penalty and its 10% dimension is removed. Divide remaining weights by 0.90, producing effective weights 16.6667%, 33.3333%, 27.7778%, 16.6667%, and 5.5556%. With scores 90, 90, 90, 90, and 90, weighted points total **90, grade A**. The scouting phase and dimension are `not_applicable`; all other required evidence can remain `complete`.

## Producer invariants

In addition to Zod structural validation, producers MUST enforce: phase object keys match their `phase`; rubric versions match at the root and snapshot; dimension IDs are unique; eligible effective weights sum to 1 (within `0.0001`); weighted points agree with score and effective weight; evidence counts and ratio agree; timestamps are ordered when an end time exists; token totals equal phase totals where all usage is complete; grade matches the final capped score; and `not_applicable` is used only for deliberately disabled optional work.
