#!/usr/bin/env bash
# Remove trailing horizontal whitespace from changed tracked text files only.

cleanup_trailing_whitespace_for_changed_files() {
  local log_file="${AUTO_LINT_CLEANUP_LOG:-/results/auto-lint-cleanup.log}"
  local max_bytes="${KASEKI_TRAILING_WHITESPACE_MAX_BYTES:-1048576}"
  local file size mime changed_count=0 cleaned_count=0 skipped_count=0

  mkdir -p "$(dirname "$log_file")" 2>/dev/null || true
  : >> "$log_file" 2>/dev/null || true

  while IFS= read -r -d '' file; do
    [ -n "$file" ] || continue

    case "$file" in
      .git/*|*/.git/*|node_modules/*|*/node_modules/*|dist/*|*/dist/*|coverage/*|*/coverage/*|.coverage/*|*/.coverage/*|htmlcov/*|*/htmlcov/*)
        printf 'Skipping excluded path: %s\n' "$file" | tee -a "$log_file"
    bash "$SCRIPT_DIR/cleanup-trailing-whitespace.sh"
        continue
        ;;
      package-lock.json|npm-shrinkwrap.json|yarn.lock|pnpm-lock.yaml|bun.lockb|bun.lock|Cargo.lock|Pipfile.lock|poetry.lock|composer.lock|Gemfile.lock|go.sum)
        printf 'Skipping lockfile: %s\n' "$file" | tee -a "$log_file"
        skipped_count=$((skipped_count + 1))
        continue
        ;;
    esac

    if ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
      printf 'Skipping untracked file: %s\n' "$file" | tee -a "$log_file"
      skipped_count=$((skipped_count + 1))
      continue
    fi
    if ! [ -f "$file" ]; then
      printf 'Skipping deleted or non-regular file: %s\n' "$file" | tee -a "$log_file"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    size=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
    size="${size:-0}"
    case "$size" in (*[!0-9]*|'') size=0 ;; esac
    if [ "$size" -gt "$max_bytes" ]; then
      printf 'Skipping large file (%s bytes): %s\n' "$size" "$file" | tee -a "$log_file"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    if git diff --numstat -- "$file" 2>/dev/null | awk '($1 == "-" && $2 == "-") { found=1 } END { exit found ? 0 : 1 }'; then
      printf 'Skipping binary diff: %s\n' "$file" | tee -a "$log_file"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    case "$file" in
      *.bash|*.bats|*.c|*.cc|*.cfg|*.conf|*.cpp|*.cs|*.css|*.cts|*.cxx|*.dockerignore|*.editorconfig|*.env.example|*.fish|*.gitattributes|*.gitignore|*.go|*.h|*.hpp|*.hs|*.html|*.ini|*.java|*.js|*.json|*.jsx|*.kt|*.kts|*.less|*.lua|*.mjs|*.md|*.mdx|*.mts|*.php|*.pl|*.pm|*.properties|*.proto|*.py|*.rb|*.rs|*.sass|*.scala|*.scss|*.sh|*.sql|*.svelte|*.swift|*.toml|*.ts|*.tsx|*.txt|*.vue|*.xml|*.yaml|*.yml|Dockerfile|Makefile|Rakefile|Gemfile|Pipfile)
        ;;
      *)
        if LC_ALL=C grep -Iq . -- "$file" 2>/dev/null || ! [ -s "$file" ]; then
          printf 'Skipping disallowed text file extension: %s\n' "$file" | tee -a "$log_file"
        else
          printf 'Skipping non-text file: %s\n' "$file" | tee -a "$log_file"
        fi
        skipped_count=$((skipped_count + 1))
        continue
        ;;
    esac

    if command -v file >/dev/null 2>&1; then
      mime="$(file --brief --mime -- "$file" 2>/dev/null || printf 'unknown')"
      case "$mime" in
        text/*|*/json*|*/xml*|inode/x-empty*|*charset=us-ascii*|*charset=utf-8*) ;;
        *)
          printf 'Skipping non-text file (%s): %s\n' "$mime" "$file" | tee -a "$log_file"
          skipped_count=$((skipped_count + 1))
          continue
          ;;
      esac
    elif ! { LC_ALL=C grep -Iq . -- "$file" 2>/dev/null || ! [ -s "$file" ]; }; then
      printf 'Skipping non-text file: %s\n' "$file" | tee -a "$log_file"
      skipped_count=$((skipped_count + 1))
      continue
    fi

    changed_count=$((changed_count + 1))
    if perl -ne '$found = 1 if /[ \t]+(?:\r?\n|\z)/; END { exit($found ? 0 : 1) }' -- "$file"; then
      perl -pi -e 's/[ \t]+(\r?\n)/$1/; s/[ \t]+\z//' -- "$file"
      cleaned_count=$((cleaned_count + 1))
      printf 'Cleaned trailing whitespace: %s\n' "$file" | tee -a "$log_file"
    fi
  done < <(git diff --name-only -z --diff-filter=ACMRT -- . 2>/dev/null || true)

  printf 'Trailing-whitespace cleanup inspected %s tracked changed text file(s), cleaned %s, skipped %s.\n' "$changed_count" "$cleaned_count" "$skipped_count" | tee -a "$log_file"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  cleanup_trailing_whitespace_for_changed_files "$@"
fi
