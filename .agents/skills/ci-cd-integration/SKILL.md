---
name: ci-cd-integration
description: Integrating kaseki-agent into CI/CD platforms for automated code changes
tags: [kaseki, ci-cd, github-actions, gitlab-ci, jenkins, automation, workflows]
relatedSkills: [prompt-engineering, environment-configuration, workflow-diagnosis, cost-optimization, quality-gate-config]
---

# CI/CD Integration for Kaseki Agent

This skill guides integration of kaseki-agent into CI/CD platforms (GitHub Actions, GitLab CI, Jenkins) for automated code generation and fixes.

## Overview

**When to Use**:
- Triggering kaseki from GitHub issues or PRs
- Automating tests or documentation generation in CI/CD
- Creating status checks that use kaseki
- Integrating with Slack/Teams notifications
- Batch processing multiple repositories

**Key Concepts**:
- Kaseki is **stateless** — runs isolated, no side effects
- Each run is **independent** — can retry without cleanup
- Results are **artifacts** — logs, diffs, summaries
- Integration is **event-driven** — triggered by webhook or schedule

---

## GitHub Actions Integration

### Trigger: Issue Comment

```yaml
name: Kaseki on Issue Command
on:
  issue_comment:
    types: [created]

jobs:
  kaseki-fix:
    runs-on: ubuntu-latest
    if: contains(github.event.comment.body, '@kaseki fix')
    steps:
      - name: Extract Issue Details
        id: issue
        run: |
          ISSUE_TITLE="${{ github.event.issue.title }}"
          ISSUE_BODY="${{ github.event.issue.body }}"
          echo "title=$ISSUE_TITLE" >> $GITHUB_OUTPUT
          echo "body=$ISSUE_BODY" >> $GITHUB_OUTPUT

      - name: Create Task Prompt from Issue
        id: prompt
        run: |
          PROMPT="
          PROBLEM: ${{ steps.issue.outputs.title }}
          
          DETAILS:
          ${{ steps.issue.outputs.body }}
          
          SCOPE: Make minimal changes to fix the issue.
          VALIDATION: All tests must pass.
          "
          echo "prompt=$PROMPT" >> $GITHUB_OUTPUT

      - name: Run Kaseki
        id: kaseki
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          REPO_URL: ${{ github.repository }}
          GIT_REF: main
          TASK_PROMPT: ${{ steps.prompt.outputs.prompt }}
          KASEKI_CHANGED_FILES_ALLOWLIST: "src/** tests/**"
        run: |
          ./run-kaseki.sh kaseki-issue-${{ github.event.issue.number }}

      - name: Post Result Comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const summary = fs.readFileSync('/agents/kaseki-results/kaseki-issue-${{ github.event.issue.number }}/result-summary.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `**Kaseki Result**\n\n${summary}`
            });
```

### Trigger: Pull Request Status Check

```yaml
name: Kaseki Validation
on: [pull_request]

jobs:
  validate-with-kaseki:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Kaseki Tests
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          REPO_URL: ${{ github.repository }}
          GIT_REF: ${{ github.head_ref }}
          TASK_PROMPT: "Validate and improve code quality"
        run: ./run-kaseki.sh kaseki-pr-${{ github.run_id }}

      - name: Check Exit Code
        run: |
          EXIT_CODE=$(cat /agents/kaseki-results/kaseki-pr-${{ github.run_id }}/exit_code)
          if [[ $EXIT_CODE -ne 0 ]]; then
            echo "❌ Kaseki validation failed: exit code $EXIT_CODE"
            cat /agents/kaseki-results/kaseki-pr-${{ github.run_id }}/result-summary.md
            exit 1
          fi
          echo "✅ Kaseki validation passed"

      - name: Upload Artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: kaseki-results-pr-${{ github.run_id }}
          path: /agents/kaseki-results/kaseki-pr-${{ github.run_id }}/
```

### Trigger: Scheduled Batch

```yaml
name: Nightly Kaseki Batch
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily

jobs:
  batch-fix:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        repo: [repo-1, repo-2, repo-3]
    steps:
      - name: Run Kaseki on ${{ matrix.repo }}
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          REPO_URL: https://github.com/org/${{ matrix.repo }}
          TASK_PROMPT: "Update dependencies and fix deprecation warnings"
          KASEKI_MODEL: openrouter/free
        run: ./run-kaseki.sh kaseki-nightly-${{ matrix.repo }}

      - name: Notify on Failure
        if: failure()
        uses: slackapi/slack-github-action@v1.24
        with:
          payload: |
            {
              "text": "❌ Kaseki batch failed for ${{ matrix.repo }}"
            }
```

---

## GitLab CI Integration

### Pipeline: Automated Bug Fixes

```yaml
stages:
  - kaseki-fix
  - validate

kaseki_bugfix:
  stage: kaseki-fix
  image: docker.io/cyanautomation/kaseki-agent:latest
  script:
    - export TASK_PROMPT="Fix deprecated API calls in src/"
    - export REPO_URL=$CI_REPOSITORY_URL
    - export GIT_REF=$CI_COMMIT_REF_NAME
    - ./run-kaseki.sh kaseki-$CI_COMMIT_SHA
  artifacts:
    paths:
      - /agents/kaseki-results/kaseki-$CI_COMMIT_SHA/
    reports:
      dotenv: kaseki.env
  only:
    - schedules  # Run on schedule, not on every commit

kaseki_validate:
  stage: validate
  script:
    - cat /agents/kaseki-results/kaseki-$CI_COMMIT_SHA/result-summary.md
    - test -f /agents/kaseki-results/kaseki-$CI_COMMIT_SHA/exit_code
  dependencies:
    - kaseki_bugfix
```

---

## Jenkins Integration

### Declarative Pipeline

```groovy
pipeline {
  agent any

  stages {
    stage('Setup') {
      steps {
        withCredentials([string(credentialsId: 'openrouter-api-key', variable: 'OPENROUTER_API_KEY')]) {
          sh '''
            export REPO_URL="https://github.com/org/repo"
            export GIT_REF="main"
            export TASK_PROMPT="Fix all lint warnings"
            export KASEKI_MODEL="openrouter/free"
          '''
        }
      }
    }

    stage('Kaseki Run') {
      steps {
        sh './run-kaseki.sh kaseki-jenkins-${BUILD_NUMBER}'
      }
    }

    stage('Validate') {
      steps {
        sh '''
          EXIT_CODE=$(cat /agents/kaseki-results/kaseki-jenkins-${BUILD_NUMBER}/exit_code)
          cat /agents/kaseki-results/kaseki-jenkins-${BUILD_NUMBER}/result-summary.md
          exit $EXIT_CODE
        '''
      }
    }

    stage('Report') {
      when {
        always()
      }
      steps {
        archiveArtifacts artifacts: '/agents/kaseki-results/kaseki-jenkins-${BUILD_NUMBER}/**'
        publishHTML([
          reportDir: '/agents/kaseki-results/kaseki-jenkins-${BUILD_NUMBER}',
          reportFiles: 'result-summary.md',
          reportName: 'Kaseki Summary'
        ])
      }
    }
  }

  post {
    failure {
      emailext(
        subject: "Kaseki Run Failed: ${BUILD_NUMBER}",
        body: readFile('/agents/kaseki-results/kaseki-jenkins-${BUILD_NUMBER}/result-summary.md'),
        to: 'team@example.com'
      )
    }
  }
}
```

---

## Generic CI/CD Pattern

For platforms not listed above (Azure Pipelines, Bitbucket, Drone, etc.):

1. **Docker container** running kaseki-agent
2. **Mount volumes** for repo and results
3. **Set environment variables** for OPENROUTER_API_KEY, REPO_URL, TASK_PROMPT
4. **Capture exit code** and artifacts
5. **Notify** on success/failure

---

## Error Handling & Retry Logic

### Automatic Retry with Backoff

```bash
#!/bin/bash
# retry-kaseki.sh

MAX_ATTEMPTS=3
ATTEMPT=1

while [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; do
  echo "Attempt $ATTEMPT/$MAX_ATTEMPTS..."
  
  ./run-kaseki.sh kaseki-retry-$ATTEMPT
  EXIT_CODE=$?
  
  if [[ $EXIT_CODE -eq 0 ]]; then
    echo "✅ Success on attempt $ATTEMPT"
    exit 0
  fi
  
  # Check if failure is retryable (not config error)
  if [[ $EXIT_CODE -eq 2 ]]; then
    echo "❌ Config error (exit code 2), not retrying"
    exit 2
  fi
  
  if [[ $ATTEMPT -lt $MAX_ATTEMPTS ]]; then
    WAIT_TIME=$((2 ** ATTEMPT))  # Exponential backoff: 2s, 4s, 8s
    echo "Waiting ${WAIT_TIME}s before retry..."
    sleep $WAIT_TIME
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
done

echo "❌ Failed after $MAX_ATTEMPTS attempts"
exit 1
```

### Handle Different Exit Codes

```bash
#!/bin/bash
# Handle specific failures

EXIT_CODE=$(cat /agents/kaseki-results/kaseki-N/exit_code)

case $EXIT_CODE in
  0)
    echo "✅ Success"
    exit 0
    ;;
  2)
    echo "❌ Config error (check API key)"
    exit 2
    ;;
  3)
    echo "⚠️  No changes made (expected for some tasks)"
    exit 0  # Don't fail
    ;;
  4)
    echo "❌ Diff too large (increase KASEKI_MAX_DIFF_BYTES)"
    exit 1
    ;;
  5)
    echo "❌ File outside allowlist (expand KASEKI_CHANGED_FILES_ALLOWLIST)"
    exit 1
    ;;
  6)
    echo "❌ Secret detected (audit prompt and code)"
    exit 1
    ;;
  7)
    echo "❌ Validation failed (check validation.log)"
    exit 1
    ;;
  124)
    echo "❌ Timeout (increase KASEKI_AGENT_TIMEOUT_SECONDS)"
    exit 1
    ;;
  *)
    echo "❌ Unknown error (exit code $EXIT_CODE)"
    exit 1
    ;;
esac
```

---

## Notifications & Reporting

### Slack Notification

```bash
#!/bin/bash
# notify-slack.sh

KASEKI_RUN=$1
RESULT_DIR="/agents/kaseki-results/$KASEKI_RUN"

STATUS=$(grep "^Status:" "$RESULT_DIR/result-summary.md" | cut -d' ' -f2-)

curl -X POST $SLACK_WEBHOOK \
  -H 'Content-Type: application/json' \
  -d "{
    \"text\": \"Kaseki Run Complete: $KASEKI_RUN\",
    \"blocks\": [
      {
        \"type\": \"section\",
        \"text\": {
          \"type\": \"mrkdwn\",
          \"text\": \"*Kaseki Result*\n$STATUS\"
        }
      }
    ]
  }"
```

### GitHub Actions Artifact Upload

```yaml
- name: Upload Kaseki Results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: kaseki-results-${{ github.run_id }}
    path: /agents/kaseki-results/kaseki-*/
    retention-days: 30
```

---

## Monitoring & Observability

### Event Streaming to Monitoring System

```bash
#!/bin/bash
# Send kaseki events to CloudWatch/Datadog

KASEKI_RUN=$1
RESULT_DIR="/agents/kaseki-results/$KASEKI_RUN"

# Extract metrics
DURATION=$(jq '.duration_seconds' "$RESULT_DIR/metadata.json")
EXIT_CODE=$(jq '.exit_codes.overall' "$RESULT_DIR/metadata.json")
FILES_CHANGED=$(jq '.changed_files | length' "$RESULT_DIR/metadata.json")

# Send to CloudWatch
aws cloudwatch put-metric-data \
  --namespace "KasekiAgent" \
  --metric-name "ExecutionDuration" \
  --value "$DURATION" \
  --unit Seconds

# Send to Datadog
curl -X POST "https://api.datadoghq.com/api/v1/events" \
  -H "DD-API-KEY: $DATADOG_API_KEY" \
  -d "{
    \"title\": \"Kaseki: $KASEKI_RUN\",
    \"text\": \"Exit code: $EXIT_CODE\nDuration: ${DURATION}s\nFiles: $FILES_CHANGED\",
    \"priority\": \"normal\"
  }"
```

---

## See Also

- [CI_CD_INTEGRATION.md](../../docs/CI_CD_INTEGRATION.md) — Comprehensive platform-specific examples
- [EXAMPLES.md](../../docs/EXAMPLES.md) — Real-world example #8 (multi-repo batch) and #10 (webhook)
- [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) — API service for remote CI/CD invocation
- [workflow-diagnosis](workflow-diagnosis.md) — Troubleshooting CI/CD failures
