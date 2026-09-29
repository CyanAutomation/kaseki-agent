# Decision models in Kaseki

Kaseki uses three layers for different kinds of work:

1. **Deterministic code** handles rules that can be checked exactly.
2. **DecisionService** handles small, bounded classifications and scores with typed answers.
3. **Pi** handles reasoning, synthesis, planning, repository exploration, and code generation.

Pi is Kaseki's creator and reasoner. The harness controls workflow decisions with deterministic rules and specialized decision models where those models add value.

## Current architecture

```text
Kaseki workflow
  ├─ deterministic policy and safeguards
  ├─ DecisionService
  │    └─ JEV decision provider (current provider)
  └─ GenerativeAgent
       └─ Pi
```

Workflow code calls the provider-neutral `DecisionService` interface. Its current adapter calls the OpenRouter Decisions API using the Typesafe model alias. A provider can be replaced or injected without changing goal-check, admission, or validation-recovery policy. There is no provider-selection environment variable yet because JEV is the only implemented decision provider.

Decision requests keep the state being evaluated separate from the fixed questions and criteria. Answers remain typed as Noul probabilities, choices with distributions, or scores with distributions. The service returns the selected provider, model, usage, duration, and request-attempt count.

## Candidate decision points

| Lifecycle point | Current classification | Reason |
| --- | --- | --- |
| Local credential-pattern screening at admission | `DETERMINISTIC` | Exact local patterns can reject obvious secret-bearing requests before model access. |
| Task risk, task type, and validation-focus classification | `DECISION_MODEL` | These are bounded labels. Risk and routing outputs use confidence thresholds; they do not replace the exact workflow controls. |
| Queueing, timeouts, retry ceilings, allowlists, validation, quality gates, secret scanning, publish mode, and scorecard arithmetic | `DETERMINISTIC` | These have explicit inputs and rules, so a model must not overrule them. |
| Goal setting and repository scouting | `GENERATIVE_LLM` | They require interpreting intent, exploring the repository, prioritizing work, and forming a plan. |
| Selecting an individual Pi tool while coding | `GENERATIVE_LLM` | The choice is part of the coding agent's ongoing reasoning. Kaseki currently has no large dynamic skill catalog whose staged disclosure would justify another classifier. |
| Goal-check criterion satisfaction | `DECISION_MODEL` | Each criterion is evaluated as a typed probability. Invalid goal contracts and required-diff rules are decided locally. Uncertain results remain uncertain and can require human review. |
| Whether another coding attempt is allowed | `DETERMINISTIC` + `DECISION_MODEL` | The model classifies goal evidence; local retry limits and terminal workflow rules control whether work can continue. |
| Validation-failure cause and recovery recommendation | `DECISION_MODEL` | The model classifies bounded failure evidence. Local policy requires a transient cause, high confidence, an exact command allowlist match, and an unused retry before any retry is authorized. |
| Run quality label and task-completion score | `DECISION_MODEL` | These are bounded assessment outputs over retained run evidence. |
| Scorecard dimensions and final score | `DETERMINISTIC` | The scorecard applies a documented formula to measured evidence; model scores do not replace the formula. |
| Explanatory result summaries and future improvement synthesis | `GENERATIVE_LLM` | Useful explanations and synthesis need more than a bounded label or score. |

## Current integrations and controls

- **Task Admission:** DecisionService classifies credential exposure, permission changes, security-boundary changes, overall risk, task type, and validation focus. Deterministic local credential screening remains authoritative for obvious credential-like content. If the decision provider is unavailable, admission follows its existing degraded fail-open behavior.
- **Goal Check:** DecisionService scores the validated success criteria against bounded, redacted run evidence. Goal Check uses `KASEKI_GOAL_CHECK_CONFIDENCE_THRESHOLD`; ambiguous evidence remains unresolved. Contract validation, diff checks, and the configured maximum coding retries remain deterministic.
- **Run Evaluation:** DecisionService returns typed quality, reviewer-confidence, and completion assessments. It runs only when the run-evaluation policy enables it.
- **Validation recovery:** The model recommendation is advisory in `observe` mode. In `auto` mode local checks still require an allowlisted command, a transient failure classification, confidence above the configured threshold, and no previous retry. It never skips a requested check.

Set `KASEKI_TYPED_EVALUATION_ENABLED=0` to use the existing Pi Goal Check and Run Evaluation stages. Validation recovery can be disabled with `KASEKI_VALIDATION_RECOVERY_MODE=off`. Provider errors, timeouts, invalid responses, or missing credentials degrade evaluation or recovery; they do not remove the deterministic quality, validation, allowlist, secret-scan, or publishing controls. Task Admission keeps its separate fail-open policy for provider outages.

Configuration and credential handling are documented in [ENV_VARS.md](ENV_VARS.md). The decision credential is not used for Pi coding inference.

## Untrusted state

Repository files, diffs, validation output, task text, and tool results are untrusted data. They are supplied as state to fixed questions; they cannot modify the locally defined question criteria or authorize an operation. State is bounded and common credential patterns are redacted before evaluation. Redaction is not a complete secret scanner. Decision-model results never override deterministic security checks or exact retry policy.

## Observability and measurement

Workflow decision calls append one compact record to `decisions.jsonl`. It records stage, status, provider, model, outcome, conservative confidence summary, duration, provider request attempts, reported token/cost usage, and the number of generative evaluation stages structurally replaced. Failure records contain an error category, not provider error text. The evaluated state and question payload are not copied into this log.

`generativeCallsAvoided` counts a Goal Check or Run Evaluation phase that the typed evaluator replaced in that run; it is a phase count, not a measured cost saving. Compare latency and reported usage in `decisions.jsonl` with Pi phase timings and token-ledger data before drawing cost or quality conclusions. Task Admission runs before a results directory exists, so its decision metadata is returned with the admission result rather than copied into this per-run artifact. A shadow mode is not enabled yet; it should be added with a replayable evaluation set so that comparisons do not require duplicate provider calls on every production run.

## Follow-up candidates

- Build a replayable evaluation set and compare decision outputs with reviewed outcomes and the previous Pi evaluator.
- Consider shadow comparisons for one stage after measuring added latency, credential/data handling, and provider cost.
- Revisit progressive skill or tool disclosure only if Kaseki begins exposing a materially larger dynamic catalog to Pi.
- Evaluate local or alternate decision providers through the existing `DecisionService` boundary when there is a concrete implementation to compare.
