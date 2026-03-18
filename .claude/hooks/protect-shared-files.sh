#!/usr/bin/env bash
# PreToolUse hook: Block edits to coordinator-owned files on worktree branches
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

[ -z "$FILE_PATH" ] && exit 0

# Skip files outside the project directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -n "$PROJECT_DIR" ] && [ -n "$FILE_PATH" ]; then
  case "$FILE_PATH" in
    "$PROJECT_DIR"/*) ;;
    *) exit 0 ;;
  esac
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Allow edits on main development branches
case "$BRANCH" in
  dev|main|master|"") exit 0 ;;
esac

# Normalize path: strip project dir prefix
FILE_PATH="${FILE_PATH#"${CLAUDE_PROJECT_DIR:-}"/}"
FILE_PATH="${FILE_PATH#./}"

# Coordinator-owned files — only the coordinator on dev/main can edit these
PROTECTED_FILES=(
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "turbo.json"
  "biome.json"
  ".npmrc"
  ".env.example"
  ".gitignore"
  "CLAUDE.md"
)

# Also protect entire directories
PROTECTED_DIRS=(
  "scripts/"
  "docker/"
)

for PROTECTED in "${PROTECTED_FILES[@]}"; do
  if [ "$FILE_PATH" = "$PROTECTED" ]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Cannot edit coordinator-owned file '$PROTECTED' from worktree branch '$BRANCH'. Request this change from the coordinator on dev/main."
  }
}
EOF
    exit 0
  fi
done

for PROTECTED_DIR in "${PROTECTED_DIRS[@]}"; do
  case "$FILE_PATH" in
    "$PROTECTED_DIR"*)
      cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Cannot edit coordinator-owned directory '$PROTECTED_DIR' from worktree branch '$BRANCH'. Request this change from the coordinator on dev/main."
  }
}
EOF
      exit 0
      ;;
  esac
done

exit 0
