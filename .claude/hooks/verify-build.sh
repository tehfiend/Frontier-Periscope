#!/usr/bin/env bash
# PreToolUse hook: Block git commit/push if build is broken
# Skips if only docs/plan files changed
set -euo pipefail

INPUT=$(cat)

cd "$CLAUDE_PROJECT_DIR"

# Skip if only docs/non-source files changed
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || true)
ALL_SOURCE=$(printf "%s\n%s" "$CHANGED_FILES" "$UNTRACKED" | grep -E '\.(ts|tsx|js|jsx|json)$' | grep -v 'docs/' | grep -v 'plans/' || true)

[ -z "$ALL_SOURCE" ] && exit 0

echo "Verifying build..."
if ! pnpm build 2>&1; then
  echo "BUILD FAILED — fix errors before committing."
  exit 2
fi

echo "Build verified successfully."
exit 0
