# GitHub workflow controls

The workflow files enforce immutable artifact promotion, but the following repository settings must also be configured in GitHub:

1. Protect `main` with the required `CI / validate` status check, require pull requests, and restrict who can bypass the rule.
2. Configure the `release` environment with required reviewers and scope the Docker Hub credentials to that environment. It protects NPM publication and Docker tag promotion.
3. Configure the `kaseki-docs-sweep` environment with required reviewers and scope `KASEKI_API_TOKEN` to it.
4. Set `KASEKI_BASE_URL` as an organization or repository Actions variable to the approved HTTPS controller endpoint. The docs sweep intentionally has no public fallback.
5. In Actions settings, allow only approved actions and require full commit-SHA pinning when the organization policy permits it.

The weekly documentation sweep uses fixed `main`, `README.md,docs/**/*.md`, and `npm run check` defaults. Manual dispatches may only use the same documentation paths; an empty or broader allowlist is rejected before the remote patch task is submitted.
