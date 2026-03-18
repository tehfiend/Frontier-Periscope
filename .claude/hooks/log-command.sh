#!/usr/bin/env bash
# PostToolUse hook (async): Log all Bash commands to command-log.jsonl
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

[ -z "$COMMAND" ] && exit 0

LOG_FILE="$CLAUDE_PROJECT_DIR/.claude/command-log.jsonl"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"

# Escape special chars for JSON
COMMAND_ESCAPED=$(echo "$COMMAND" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g')

echo "{\"ts\":\"$TIMESTAMP\",\"session\":\"$SESSION_ID\",\"command\":\"$COMMAND_ESCAPED\"}" >> "$LOG_FILE"

exit 0
