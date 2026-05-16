# Backlog

## TypeScript debt burn-down to restore full blocking type-check

- **Status:** Open
- **Owner:** Engineering
- **Created:** 2026-05-02
- **Goal:** Reduce and eliminate full-project TypeScript errors so `npm run type-check:full` can be promoted from informational to required CI gating.

### Acceptance criteria

1. `npm run type-check:full` passes on `main` with zero TypeScript errors.
2. CI updates `type-check:full` from non-blocking informational to blocking for pull requests.
3. Any temporary suppressions added during burn-down are removed or documented with owner + expiry.

### Notes

- Pull request gating currently uses `npm run type-check:changed`.
- Full-project type-check is still executed and reported as an artifact to measure baseline progress.
