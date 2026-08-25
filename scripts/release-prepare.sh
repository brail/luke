#!/usr/bin/env bash
#
# Prepara una release: CHANGELOG + versioni nei package.json.
#
# Non committa e non tagga — quelle restano decisioni esplicite. Fa il pezzo
# meccanico, che è dove si sbaglia: `sync-version` senza argomenti legge il tag
# **esistente**, quindi al momento del bump porterebbe i package.json alla
# versione precedente invece che a quella nuova. Il guard in `.husky/pre-push`
# lo intercetterebbe al `git push` del tag, ma dopo aver fatto perdere il giro.
#
# Il numero di versione ha una sola fonte: `git-cliff --bumped-version`, che lo
# calcola dai conventional commit. Lo stesso valore finisce nel CHANGELOG e nei
# package.json, così non possono divergere.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree non pulito. Committa o stasha prima di preparare una release." >&2
  git status --short >&2
  exit 1
fi

TAG=$(pnpm exec git-cliff --bumped-version 2>/dev/null | tail -1)
VERSION="${TAG#v}"

if [ -z "$VERSION" ]; then
  echo "❌ git-cliff non ha calcolato una versione. Ci sono conventional commit dall'ultimo tag?" >&2
  exit 1
fi

echo "📦 Prossima versione: $TAG"
echo

pnpm exec git-cliff --unreleased --tag "$TAG" --prepend CHANGELOG.md
echo "✅ CHANGELOG.md aggiornato"
echo

node scripts/sync-version.js --set "$VERSION"
echo

# Il guard del pre-push confronta i package.json col tag. Qui il tag non esiste
# ancora, quindi si verifica contro il valore appena imposto: se qualcosa non ha
# preso, si scopre adesso e non al push.
if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  echo "❌ CHANGELOG.md non contiene il blocco [$VERSION]: il push del tag verrebbe bloccato." >&2
  exit 1
fi

cat <<EOF
──────────────────────────────────────────────────────────
  Pronto. Restano tre passi, volutamente manuali:

    git diff                       # rivedi CHANGELOG e versioni
    git commit -am "chore: bump version to $VERSION"
    git tag $TAG && git push origin $TAG

  Il pre-push verifica blocco CHANGELOG e allineamento versioni.
──────────────────────────────────────────────────────────
EOF
