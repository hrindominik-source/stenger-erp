#!/usr/bin/env bash
# Integracne testy proti LOKALNEMU Supabase (nikdy nie produkcia).
# Predpoklad: npx supabase start + npx supabase db reset.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "API_URL nie je lokalne ($API_URL) - koniec." >&2; exit 1 ;;
esac
LOCAL_SUPABASE_URL="$API_URL" LOCAL_SUPABASE_ANON_KEY="$ANON_KEY" LOCAL_SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY" \
  npx vitest run --pool=forks --no-file-parallelism src/lib/hr/finalPdf.server.it.test.js src/lib/hr/kiosk.server.it.test.js src/lib/hr/signing.server.it.test.js src/lib/hr/delivery.server.it.test.js src/lib/hr/email.server.it.test.js src/lib/hr/declarations.server.it.test.js "$@"
