# CI/CD Integration Guide

This guide shows how to integrate kaseki-agent into common CI/CD platforms: GitHub Actions, GitLab CI, and Jenkins.

---

## GitHub Actions Integration

### Basic Workflow: Auto-Fix on Issue Label

```yaml
name: Kaseki Auto-Fix

on:
  issues:
    types: [opened, labeled]

jobs:
  kaseki-fix:
    runs-on: ubuntu-latest
    if: contains(github.event.issue.labels.*.name, 'auto-fix')
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Extract task from issue
        id: task
        run: |
          # Parse issue title and body as task prompt
          TASK_PROMPT="${{ github.event.issue.title }}
          
          Details:
          ${{ github.event.issue.body }}"
          
          echo "prompt=$TASK_PROMPT" >> $GITHUB_OUTPUT
      
      - name: Submit to Kaseki API
        id: submit
        run: |
          RESPONSE=$(curl -s -X POST \
            -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "repoUrl": "https://github.com/${{ github.repository }}",
              "gitRef": "${{ github.event.repository.default_branch }}",
              "taskPrompt": "${{ steps.task.outputs.prompt }}",
              "timeoutSeconds": 1800
            }' \
            http://kaseki-api:8080/api/runs)
          
          INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
          echo "instance_id=$INSTANCE_ID" >> $GITHUB_OUTPUT
          echo "✓ Submitted: $INSTANCE_ID"
      
      - name: Wait for completion
        run: |
          INSTANCE_ID="${{ steps.submit.outputs.instance_id }}"
          ELAPSED=0
          
          while [ $ELAPSED -lt 2100 ]; do
            STATUS=$(curl -s \
              -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
              http://kaseki-api:8080/api/runs/$INSTANCE_ID | jq -r '.status')
            
            if [ "$STATUS" = "completed" ]; then
              echo "Run completed: $INSTANCE_ID"
              exit 0
            fi
            
            echo "Status: $STATUS (${ELAPSED}s elapsed)"
            sleep 10
            ELAPSED=$((ELAPSED + 10))
          done
          
          echo "Timeout waiting for run completion"
          exit 1
      
      - name: Create pull request
        if: success()
        run: |
          INSTANCE_ID="${{ steps.submit.outputs.instance_id }}"
          
          # Get changes from results directory
          # (In practice, you'd fetch from kaseki-api artifacts endpoint)
          
          # Create branch
          git config user.name "kaseki-agent[bot]"
          git config user.email "kaseki-agent@github.com"
          
          BRANCH="kaseki-fix-issue-${{ github.event.issue.number }}"
          git checkout -b "$BRANCH"
          
          # Apply changes (example; actual diff retrieval depends on API)
          # Apply patch from kaseki results
          
          git add -A
          git commit -m "Fix: Issue #${{ github.event.issue.number }} via Kaseki Agent"
          git push origin "$BRANCH"
          
          # Create PR
          gh pr create \
            --title "Fix: Issue #${{ github.event.issue.number }}" \
            --body "Automated fix via Kaseki Agent for issue #${{ github.event.issue.number }}" \
            --head "$BRANCH" \
            --base "${{ github.event.repository.default_branch }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Workflow: Add Tests on Push

```yaml
name: Add Tests

on:
  push:
    paths:
      - 'src/**/*.ts'  # New source files
    branches:
      - main

jobs:
  add-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Detect untested files
        id: detect
        run: |
          # Find .ts files in src without corresponding .test.ts
          UNTESTED=$(find src -name "*.ts" -not -name "*.test.ts" | while read file; do
            TEST_FILE="${file%.ts}.test.ts"
            [ ! -f "$TEST_FILE" ] && echo "$file"
          done | head -1)
          
          if [ -z "$UNTESTED" ]; then
            echo "tested=false" >> $GITHUB_OUTPUT
            exit 0
          fi
          
          echo "untested_file=$UNTESTED" >> $GITHUB_OUTPUT
          echo "tested=true" >> $GITHUB_OUTPUT
      
      - name: Submit test generation to Kaseki
        if: steps.detect.outputs.tested == 'true'
        id: kaseki
        run: |
          FILE="${{ steps.detect.outputs.untested_file }}"
          TASK="Add comprehensive unit tests for $FILE in tests/ directory. Achieve >80% coverage."
          
          RESPONSE=$(curl -s -X POST \
            -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "repoUrl": "https://github.com/${{ github.repository }}",
              "gitRef": "${{ github.ref }}",
              "taskPrompt": "'"$TASK"'",
              "allowlist": ["tests/**/*.test.ts"]
            }' \
            http://kaseki-api:8080/api/runs)
          
          INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
          echo "instance_id=$INSTANCE_ID" >> $GITHUB_OUTPUT
      
      - name: Open PR with tests
        if: steps.kaseki.outputs.instance_id
        run: |
          # Similar to previous example: fetch results and create PR
          echo "Tests generated by Kaseki"
```

### Workflow: Status Check Integration

```yaml
name: Kaseki Status Check

on:
  pull_request:

jobs:
  kaseki-validate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Kaseki validation
        id: kaseki
        run: |
          # Validate PR changes with kaseki-agent
          RESPONSE=$(curl -s -X POST \
            -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "repoUrl": "https://github.com/${{ github.repository }}",
              "gitRef": "${{ github.head_ref }}",
              "taskPrompt": "Validate and review the changes in this PR"
            }' \
            http://kaseki-api:8080/api/runs)
          
          INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
          echo "instance_id=$INSTANCE_ID" >> $GITHUB_OUTPUT
      
      - name: Wait and report results
        run: |
          # Poll until complete, then report status
          INSTANCE_ID="${{ steps.kaseki.outputs.instance_id }}"
          # ... (polling logic from previous examples)
          
          # Create status check
          EXIT_CODE=$(curl -s \
            -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
            http://kaseki-api:8080/api/runs/$INSTANCE_ID | jq -r '.exitCode')
          
          if [ "$EXIT_CODE" = "0" ]; then
            echo "✓ Kaseki validation passed"
            exit 0
          else
            echo "✗ Kaseki validation failed: exit code $EXIT_CODE"
            exit 1
          fi
```

---

## GitLab CI Integration

### Basic Pipeline: Auto-Fix Issues

```yaml
kaseki-fix-issue:
  stage: fix
  image: alpine:latest
  script:
    - |
      # Extract task from GitLab issue
      TASK_PROMPT="Fix issue: $CI_COMMIT_MESSAGE"
      
      # Submit to Kaseki
      RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $KASEKI_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "repoUrl": "'$CI_REPOSITORY_URL'",
          "gitRef": "'$CI_COMMIT_BRANCH'",
          "taskPrompt": "'"$TASK_PROMPT"'",
          "timeoutSeconds": 1800
        }' \
        http://kaseki-api:8080/api/runs)
      
      INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
      echo "Kaseki run: $INSTANCE_ID"
      
      # Wait for completion
      ELAPSED=0
      while [ $ELAPSED -lt 2100 ]; do
        STATUS=$(curl -s \
          -H "Authorization: Bearer $KASEKI_API_KEY" \
          http://kaseki-api:8080/api/runs/$INSTANCE_ID | jq -r '.status')
        
        [ "$STATUS" = "completed" ] && exit 0
        sleep 10
        ELAPSED=$((ELAPSED + 10))
      done
      
      exit 1
  only:
    - merge_requests
  retry:
    max: 2
    when:
      - runner_system_failure
```

### Pipeline with Artifacts

```yaml
kaseki-create-pr:
  stage: automated-fix
  image: alpine:latest
  script:
    - apk add --no-cache curl git
    
    - |
      # Submit task
      RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $KASEKI_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "repoUrl": "'$CI_REPOSITORY_URL'",
          "gitRef": "'$CI_COMMIT_BRANCH'",
          "taskPrompt": "Add missing tests for uncovered functions"
        }' \
        http://kaseki-api:8080/api/runs)
      
      INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
      
      # Wait for completion
      while true; do
        RESULT=$(curl -s \
          -H "Authorization: Bearer $KASEKI_API_KEY" \
          http://kaseki-api:8080/api/runs/$INSTANCE_ID)
        
        STATUS=$(echo "$RESULT" | jq -r '.status')
        [ "$STATUS" = "completed" ] && break
        sleep 10
      done
      
      # Save results
      echo "$RESULT" | jq '.' > kaseki-results.json
  artifacts:
    paths:
      - kaseki-results.json
    expire_in: 30 days
  only:
    - main
```

---

## Jenkins Integration

### Declarative Pipeline: Auto-Fix

```groovy
pipeline {
  agent any
  
  parameters {
    string(name: 'TASK_PROMPT', description: 'Task for Kaseki Agent')
    string(name: 'GIT_REF', defaultValue: 'main', description: 'Git ref to use')
  }
  
  stages {
    stage('Submit to Kaseki') {
      steps {
        script {
          def response = sh(
            script: '''
              curl -s -X POST \
                -H "Authorization: Bearer ${KASEKI_API_KEY}" \
                -H "Content-Type: application/json" \
                -d '{
                  "repoUrl": "'${GIT_REPOSITORY_URL}'",
                  "gitRef": "'${TASK_GIT_REF}'",
                  "taskPrompt": "'${TASK_PROMPT}'",
                  "timeoutSeconds": 1800
                }' \
                http://kaseki-api:8080/api/runs
            ''',
            returnStdout: true
          ).trim()
          
          env.KASEKI_INSTANCE_ID = readJSON(text: response).instanceId
          echo "Kaseki Instance: ${env.KASEKI_INSTANCE_ID}"
        }
      }
    }
    
    stage('Wait for Completion') {
      steps {
        script {
          def completed = false
          def maxAttempts = 210  // 35 minutes
          
          for (int i = 0; i < maxAttempts; i++) {
            sleep(time: 10, unit: 'SECONDS')
            
            def status = sh(
              script: '''
                curl -s \
                  -H "Authorization: Bearer ${KASEKI_API_KEY}" \
                  http://kaseki-api:8080/api/runs/${KASEKI_INSTANCE_ID} \
                  | jq -r '.status'
              ''',
              returnStdout: true
            ).trim()
            
            if (status == 'completed') {
              completed = true
              break
            }
            
            echo "Waiting... (attempt ${i+1}/${maxAttempts})"
          }
          
          if (!completed) {
            error('Kaseki run timeout')
          }
        }
      }
    }
    
    stage('Publish Results') {
      steps {
        script {
          def results = sh(
            script: '''
              curl -s \
                -H "Authorization: Bearer ${KASEKI_API_KEY}" \
                http://kaseki-api:8080/api/runs/${KASEKI_INSTANCE_ID}
            ''',
            returnStdout: true
          ).trim()
          
          writeFile(file: 'kaseki-results.json', text: results)
          
          def exitCode = readJSON(file: 'kaseki-results.json').exitCode
          if (exitCode != 0) {
            unstable("Kaseki run failed with exit code ${exitCode}")
          }
        }
      }
    }
  }
  
  post {
    always {
      archiveArtifacts artifacts: 'kaseki-results.json', allowEmptyArchive: true
    }
  }
}
```

### Scripted Pipeline: Batch Processing

```groovy
node {
  stage('Checkout') {
    checkout scm
  }
  
  def repos = [
    'myorg/repo1',
    'myorg/repo2',
    'myorg/repo3'
  ]
  
  def results = [:]
  
  stage('Submit Kaseki Runs') {
    repos.each { repo ->
      def response = sh(
        script: '''
          curl -s -X POST \
            -H "Authorization: Bearer ${KASEKI_API_KEY}" \
            -H "Content-Type: application/json" \
            -d '{
              "repoUrl": "https://github.com/''${repo}''",
              "gitRef": "main",
              "taskPrompt": "Add missing documentation"
            }' \
            http://kaseki-api:8080/api/runs
        ''',
        returnStdout: true
      ).trim()
      
      results[repo] = readJSON(text: response).instanceId
      echo "Submitted ${repo}: ${results[repo]}"
    }
  }
  
  stage('Wait for Completions') {
    results.each { repo, instanceId ->
      def completed = false
      
      for (int i = 0; i < 210; i++) {
        def status = sh(
          script: "curl -s http://kaseki-api:8080/api/runs/${instanceId} | jq -r '.status'",
          returnStdout: true
        ).trim()
        
        if (status == 'completed') {
          completed = true
          break
        }
        
        sleep(time: 10, unit: 'SECONDS')
      }
      
      if (completed) {
        echo "✓ ${repo} completed"
      } else {
        echo "✗ ${repo} timed out"
      }
    }
  }
  
  stage('Report') {
    echo "Batch processing complete"
    results.each { repo, instanceId ->
      echo "  ${repo}: $instanceId"
    }
  }
}
```

---

## Generic CI/CD Integration Pattern

All CI platforms follow this pattern:

```
1. Trigger event (push, PR, issue, schedule)
   ↓
2. Extract task prompt from trigger context
   ↓
3. Submit to Kaseki API:
   POST /api/runs
   {
     "repoUrl": "...",
     "gitRef": "...",
     "taskPrompt": "...",
     "allowlist": [...],
     "timeoutSeconds": ...
   }
   
   Response:
   {
     "instanceId": "kaseki-N",
     "status": "queued"
   }
   ↓
4. Poll for completion:
   GET /api/runs/{instanceId}
   
   Loop until status === "completed"
   
   Final response:
   {
     "instanceId": "kaseki-N",
     "status": "completed",
     "exitCode": 0,
     "changedFiles": [...],
     "resultsDir": "/agents/kaseki-results/kaseki-N"
   }
   ↓
5. Handle results by exit code:
   - 0: Success → create PR or merge
   - 1-7: Failure → log, alert, or retry
   - 124: Timeout → increase KASEKI_AGENT_TIMEOUT_SECONDS
   ↓
6. Create PR/merge with changes (if applicable)
```

---

## Environment Variables for CI/CD

| Variable | Where to Set | Value |
|----------|---|---|
| `KASEKI_API_KEY` | GitHub Secrets / GitLab CI / Jenkins | Your Kaseki API key |
| `KASEKI_API_URL` | CI env var or hardcoded | `http://kaseki-api:8080` (internal) or `https://api.kaseki.example.com` (external) |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | CI env var | 1800-3600 (adjust per task) |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | CI env var | space-separated patterns |

---

## Error Handling

### Handle Exit Codes

```bash
EXIT_CODE=$(curl -s http://kaseki-api:8080/api/runs/$INSTANCE_ID | jq -r '.exitCode')

case $EXIT_CODE in
  0)
    echo "✓ Success"
    # Create PR, merge, etc.
    ;;
  1)
    echo "✗ Generic failure"
    # Investigate, notify team
    ;;
  4)
    echo "✗ Diff too large"
    # Use allowlist, increase limit
    ;;
  5)
    echo "✗ File outside allowlist"
    # Review allowlist config
    ;;
  7)
    echo "✗ Validation failed"
    # Check validation.log
    ;;
  124)
    echo "✗ Timeout"
    # Increase KASEKI_AGENT_TIMEOUT_SECONDS
    ;;
esac
```

### Retry Logic

```bash
ATTEMPT=1
MAX_ATTEMPTS=3

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $KASEKI_API_KEY" \
    http://kaseki-api:8080/api/runs \
    -d "{...}")
  
  INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
  
  if [ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "null" ]; then
    # Successfully submitted
    break
  fi
  
  echo "Submission failed (attempt $ATTEMPT/$MAX_ATTEMPTS)"
  ATTEMPT=$((ATTEMPT + 1))
  sleep $((ATTEMPT * 10))  # Exponential backoff
done

if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
  echo "Max retries exceeded"
  exit 1
fi
```

---

## Monitoring in CI/CD

### Failure Notifications

```bash
# Notify Slack on failure
if [ "$EXIT_CODE" != "0" ]; then
  curl -X POST \
    -H 'Content-type: application/json' \
    -d "{
      \"text\": \"Kaseki run failed: $INSTANCE_ID\",
      \"channel\": \"#kaseki-alerts\"
    }" \
    "$SLACK_WEBHOOK_URL"
fi
```

### Artifact Collection

```bash
# Archive results for later inspection
mkdir -p kaseki-artifacts
cp /agents/kaseki-results/$INSTANCE_ID/* kaseki-artifacts/

# Save for CI artifact storage
tar czf kaseki-results-$INSTANCE_ID.tar.gz kaseki-artifacts/
```

---

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) — API service setup
- [EXAMPLES.md](EXAMPLES.md) — Real-world use cases
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Debugging failures
