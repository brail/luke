#!/usr/bin/env bash
# restart-dev.sh — Spegni, pulisci cache, ricompila e riavvia l'ambiente di sviluppo Luke

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "🛑  Fermo i processi in esecuzione..."
lsof -ti:3000,3001 | xargs kill -9 2>/dev/null || true
pkill -f "turbo run dev" 2>/dev/null || true
pkill -f "next dev"     2>/dev/null || true
pkill -f "tsx watch"    2>/dev/null || true
sleep 1

# Verifica porte libere
for PORT in 3000 3001; do
  if lsof -ti:$PORT &>/dev/null; then
    echo "❌  Porta $PORT ancora occupata — forzo kill..."
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
  fi
done
echo "✅  Porte 3000 e 3001 libere"

echo ""
echo "🗑️   Svuoto la cache..."
rm -rf \
  apps/web/.next \
  apps/api/dist \
  packages/core/dist \
  .turbo
echo "✅  Cache pulita"

echo ""
echo "📦  Ricompilo @luke/core..."
pnpm --filter @luke/core build
echo "✅  @luke/core compilato"

echo ""
echo "🚀  Avvio tutti i processi in background..."
pnpm dev > /tmp/luke-dev.log 2>&1 &
DEV_PID=$!
echo "   PID: $DEV_PID  |  Log: /tmp/luke-dev.log"

echo ""
echo "⏳  Attendo che i servizi siano pronti..."
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  API_OK=$(grep -c "Luke API server listening" /tmp/luke-dev.log 2>/dev/null || echo 0)
  WEB_OK=$(grep -c "Ready in" /tmp/luke-dev.log 2>/dev/null || echo 0)

  if [ "$API_OK" -gt 0 ] && [ "$WEB_OK" -gt 0 ]; then
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

echo ""
if [ "$API_OK" -gt 0 ] && [ "$WEB_OK" -gt 0 ]; then
  echo "✅  Tutti i servizi sono pronti!"
  echo ""
  echo "   🌐  Web  →  http://localhost:3000"
  echo "   🔌  API  →  http://localhost:3001"
else
  echo "⚠️   Timeout — controlla il log: /tmp/luke-dev.log"
  echo "   Ultimi 20 righe:"
  tail -20 /tmp/luke-dev.log
fi
