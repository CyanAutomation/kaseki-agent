# Documentation Consolidation Map

This page maps superseded material to current guidance. It is not a second
documentation index. For active guides, use the [documentation index](INDEX.md);
for every tracked Markdown file and its role, see the
[repository inventory](internal/MARKDOWN_INVENTORY.md).

## Current information architecture

| Area | Purpose |
| --- | --- |
| Repository root | Project entry point, release history, contribution guidance, and assistant instructions |
| `docs/` | Current user guides, product references, and feature design notes |
| `docs/internal/` | Engineering notes, internal plans, and audit material |
| `docs/configuration-audit/` | Configuration rationalization work papers |
| `docs/archive/` | Completed investigations, dated reports, and superseded guides |
| `.agents/skills/` | Agent-facing operational knowledge and skill references |
| `.github/` and `scripts/templates/` | Templates maintained beside the systems that consume them |
| `perf/` and `tests/` | Local performance and test instructions |

The root-level project reports and Pi setup snapshots now live in
[`archive/project-reports/`](archive/project-reports/README.md). Their old
paths were repository-local reports rather than supported product entry
points; use the archive index to find them.

## Where older guidance belongs

| Older material | Current guidance |
| --- | --- |
| Detailed all-variable configuration guide | [Environment variable reference](ENV_VARS.md) for names and defaults; [advanced configuration](ADVANCED_CONFIG.md) for navigation. The previous long guide is archived. |
| Goal-setting improvements, practical guide, and phase exit codes | [Goal-setting guide](GOAL_SETTING_GUIDE.md) and [exit codes](EXIT_CODES.md); the May 2026 comprehensive guide is archived |
| Artifact consumption and scoring research | [Artifact schema overview](ARTIFACT_SCHEMAS.md); the June 2026 value-scoring proposal is historical, and current scorecards are described in [run scorecard design](RUN_SCORECARD_DESIGN.md) |
| Host setup stages and troubleshooting | [Host setup API reference](HOST_SETUP_API_REFERENCE.md) and [current deployment guide](DEPLOYMENT.md) |
| Evaluation rollout notes | [Evaluation best practices](EVALUATION_BEST_PRACTICES.md) |
| Test-isolation quick reference and postmortem | [Test isolation best practices](TEST_ISOLATION_BEST_PRACTICES.md) |
| Previous multi-mode deployment guide | [Current deployment guide](DEPLOYMENT.md) and [Docker setup](DOCKER_SETUP.md) |
| Previous root-level issue and implementation reports | [`archive/project-reports/`](archive/project-reports/README.md) |

Original material remains available under `docs/archive/`. An archive entry is
historical context; the current guide linked above is the source for supported
behavior.

## Maintenance rules

1. Add new user instructions to an existing canonical guide when the subject
   and audience match.
2. Keep environment names and defaults in [the environment reference](ENV_VARS.md);
   use [advanced configuration](ADVANCED_CONFIG.md) for behavior and examples.
3. Keep implementation notes and project reports out of the user setup path.
4. When retiring a page, update inbound links, the archive index, and the
   [repository inventory](internal/MARKDOWN_INVENTORY.md).
5. Run `npm run check:markdown-links` after documentation changes. The command
   checks every tracked Markdown file by default.
