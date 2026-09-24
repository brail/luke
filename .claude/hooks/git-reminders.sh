#!/bin/sh
# Pre-tool reminder for risky git commands, or ones whose checklist is easy to forget

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

case "$cmd" in
  *"git commit"*)
    echo "" >&2
    echo "⚠️  Pre-commit check:" >&2
    echo "   • /simplify already run? (semantic review)" >&2
    echo "   • Gates: .husky/pre-commit (gitleaks+semgrep — runs now) · .husky/pre-push (typecheck, tools/, test, pnpm check:drift — runs before push)" >&2
    echo "" >&2
    ;;
  *"git tag"*)
    echo "" >&2
    echo "⚠️  Pre-tag check:" >&2
    echo "   • Does CHANGELOG.md have the section for this version? (pnpm release:prepare <tag>)" >&2
    echo "   • Are you on the right branch? (\`git branch --show-current\`)" >&2
    echo "" >&2
    ;;
esac
exit 0