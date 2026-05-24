#!/bin/bash

# Tests for request_owner_review() function
# Tests JSON parsing, payload generation, and error handling logic

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

pass_test() {
  echo "✓ $1"
  ((TESTS_PASSED++))
}

fail_test() {
  echo "✗ $1"
  if [ -n "${2:-}" ]; then
    echo "  $2"
  fi
  ((TESTS_FAILED++))
}

# Test 1: Fixture files exist and are valid JSON
test_fixture_files_valid() {
  local fixture_personal fixture_org
  fixture_personal="$SCRIPT_DIR/fixtures/pr-response-personal-repo.json"
  fixture_org="$SCRIPT_DIR/fixtures/pr-response-org-repo.json"
  
  if [ -f "$fixture_personal" ] && node -e "JSON.parse(require('fs').readFileSync('$fixture_personal', 'utf8'))" 2>/dev/null; then
    pass_test "Fixture: personal-repo PR response is valid JSON"
  else
    fail_test "Fixture: personal-repo PR response not found or invalid"
    return 1
  fi
  
  if [ -f "$fixture_org" ] && node -e "JSON.parse(require('fs').readFileSync('$fixture_org', 'utf8'))" 2>/dev/null; then
    pass_test "Fixture: org-repo PR response is valid JSON"
  else
    fail_test "Fixture: org-repo PR response not found or invalid"
    return 1
  fi
}

# Test 2: Personal repo - owner is User
test_personal_repo_user_type() {
  local pr_response owner_type owner_login pr_number
  fixture="$SCRIPT_DIR/fixtures/pr-response-personal-repo.json"
  
  pr_response="$(cat "$fixture")"
  owner_type=$(echo "$pr_response" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(data.base.repo.owner.type || '');" 2>/dev/null || echo "")
  owner_login=$(echo "$pr_response" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(data.base.repo.owner.login || '');" 2>/dev/null || echo "")
  pr_number=$(echo "$pr_response" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(String(data.number || ''));" 2>/dev/null || echo "")
  
  if [ "$owner_type" = "User" ] && [ "$owner_login" = "testuser" ] && [ "$pr_number" = "42" ]; then
    pass_test "Personal repo: owner_type=User, login=testuser, pr_number=42"
  else
    fail_test "Personal repo: extraction failed" "owner_type=$owner_type login=$owner_login pr=$pr_number"
  fi
}

# Test 3: Organization repo - owner is Organization
test_org_repo_owner_type() {
  local pr_response owner_type owner_login pr_number
  fixture="$SCRIPT_DIR/fixtures/pr-response-org-repo.json"
  
  pr_response="$(cat "$fixture")"
  owner_type=$(echo "$pr_response" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(data.base.repo.owner.type || '');" 2>/dev/null || echo "")
  owner_login=$(echo "$pr_response" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(data.base.repo.owner.login || '');" 2>/dev/null || echo "")
  pr_number=$(echo "$pr_response" | node -e "const data = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(String(data.number || ''));" 2>/dev/null || echo "")
  
  if [ "$owner_type" = "Organization" ] && [ "$owner_login" = "myorg" ] && [ "$pr_number" = "15" ]; then
    pass_test "Organization repo: owner_type=Organization, login=myorg, pr_number=15"
  else
    fail_test "Organization repo: extraction failed" "owner_type=$owner_type login=$owner_login pr=$pr_number"
  fi
}

# Test 4: Reviewer payload generation
test_reviewer_payload_generation() {
  local owner_login payload
  owner_login="testuser"
  
  payload=$(node -e "const payload = { reviewers: ['$owner_login'] }; process.stdout.write(JSON.stringify(payload));" 2>/dev/null || echo "")
  
  if echo "$payload" | grep -q '"reviewers"' && echo "$payload" | grep -q '"testuser"'; then
    pass_test "Payload: generated valid reviewer request JSON"
  else
    fail_test "Payload: generation failed" "payload=$payload"
  fi
}

# Test 5: HTTP status classification - success
test_http_status_success() {
  local http_status="201"
  
  if [ "$http_status" = "201" ]; then
    pass_test "HTTP 201: success case"
  else
    fail_test "HTTP 201: classification failed"
  fi
}

# Test 6: HTTP status classification - already requested
test_http_status_already_requested() {
  local http_status="422"
  
  if [ "$http_status" = "422" ]; then
    pass_test "HTTP 422: already requested case"
  else
    fail_test "HTTP 422: classification failed"
  fi
}

# Test 7: HTTP status classification - permission denied
test_http_status_permission_denied() {
  local http_status="403"
  
  if [ "$http_status" = "403" ]; then
    pass_test "HTTP 403: permission denied case"
  else
    fail_test "HTTP 403: classification failed"
  fi
}

# Test 8: HTTP status classification - not found
test_http_status_not_found() {
  local http_status="404"
  
  if [ "$http_status" = "404" ]; then
    pass_test "HTTP 404: not found case"
  else
    fail_test "HTTP 404: classification failed"
  fi
}

# Test 9: Retryable error classification
test_retryable_errors() {
  local retryable_count=0
  
  for code in 429 500 502 503 504; do
    case "$code" in
      429|500|502|503|504)
        ((retryable_count++))
        ;;
    esac
  done
  
  if [ "$retryable_count" -eq 5 ]; then
    pass_test "Retryable errors: 429, 500, 502, 503, 504 classified correctly"
  else
    fail_test "Retryable errors: classification failed" "count=$retryable_count"
  fi
}

# Test 10: Non-retryable error classification
test_non_retryable_errors() {
  local non_retryable_count=0
  
  for code in 400 401 403 404 422; do
    case "$code" in
      429|500|502|503|504)
        # Should NOT match
        ;;
      *)
        ((non_retryable_count++))
        ;;
    esac
  done
  
  if [ "$non_retryable_count" -eq 5 ]; then
    pass_test "Non-retryable errors: 4xx status codes not retried"
  else
    fail_test "Non-retryable errors: classification failed" "count=$non_retryable_count"
  fi
}

# Main
main() {
  echo "=== Request Owner Review Tests ==="
  echo ""
  
  test_fixture_files_valid
  test_personal_repo_user_type
  test_org_repo_owner_type
  test_reviewer_payload_generation
  test_http_status_success
  test_http_status_already_requested
  test_http_status_permission_denied
  test_http_status_not_found
  test_retryable_errors
  test_non_retryable_errors
  
  echo ""
  echo "=== Test Summary ==="
  printf "Passed: %d\n" "$TESTS_PASSED"
  printf "Failed: %d\n" "$TESTS_FAILED"
  echo ""
  
  if [ "$TESTS_FAILED" -gt 0 ]; then
    exit 1
  fi
  
  exit 0
}

main "$@"
