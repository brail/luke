#!/bin/sh
# Pre-tool reminder per comandi git rischiosi / che si dimenticano sempre

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

case "$cmd" in
  *"git commit"*)
    echo "" >&2
    echo "⚠️  Pre-commit check:" >&2
    echo "   • /simplify già eseguito? (review semantico)" >&2
    echo "   • pnpm typecheck + lint + test verdi?" >&2
    echo "" >&2
    ;;
  *"git tag"*)
    echo "" >&2
    echo "⚠️  Pre-tag check:" >&2
    echo "   • CHANGELOG.md ha il blocco per questa versione?" >&2
    echo "   • package.json bumpati al numero finale (no -dev.X)?" >&2
    echo "   • Sei sul branch corretto? (\`git branch --show-current\`)" >&2
    echo "" >&2
    ;;
esac
exit 0