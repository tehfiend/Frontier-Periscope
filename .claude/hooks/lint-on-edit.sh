#!/usr/bin/env bash
# PostToolUse hook: Run biome lint on edited files
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

[ -z "$FILE_PATH" ] && exit 0

# Only lint source files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json) ;;
  *) exit 0 ;;
esac

# Skip files outside the project
case "$FILE_PATH" in
  */node_modules/*|*/dist/*|*/.next/*|*/.turbo/*) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR"

# Run biome check on the specific file
OUTPUT=$(npx biome check "$FILE_PATH" 2>&1) || true

# If there are errors, report them
if echo "$OUTPUT" | grep -q "Found [0-9]* error"; then
  echo "Lint issues in $FILE_PATH:"
  echo "$OUTPUT"
fi

exit 0
