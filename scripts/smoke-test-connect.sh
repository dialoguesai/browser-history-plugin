#!/usr/bin/env bash
# Smoke-test browser-plugin Grant Access wiring against Control Plane.
# Does NOT complete OAuth — validates app config, redirect URIs, and secret fingerprint.
#
# Usage:
#   CONTROL_PLANE_URL=https://cp.logu3s.com \
#   EXTENSION_ID=nhchpdllklekegfalgklbeedainhjjif \
#   CLIENT_SECRET=cas_... \
#   ./scripts/smoke-test-connect.sh
#
# Optional: CONTROL_PLANE_ADMIN_KEY (only needed for GET /v1/apps/browser-plugin)

set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://cp.logu3s.com}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL%/}"
APP_ID="${APP_ID:-browser-plugin}"
EXTENSION_ID="${EXTENSION_ID:?Set EXTENSION_ID (from arc://extensions)}"
CLIENT_SECRET="${CLIENT_SECRET:?Set CLIENT_SECRET (cas_... from docs or client-auth/issue)}"
ADMIN_KEY="${CONTROL_PLANE_ADMIN_KEY:-}"

REDIRECT_CHROMIUM="https://${EXTENSION_ID}.chromiumapp.org/"
REDIRECT_OPTIONS="chrome-extension://${EXTENSION_ID}/options.html"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "Control Plane: $CONTROL_PLANE_URL"
echo "Extension ID:  $EXTENSION_ID"
echo "Secret prefix: ${CLIENT_SECRET:0:8}... last4: ${CLIENT_SECRET: -4}"
echo ""

echo "1) GET /connect (chromiumapp redirect — Arc OAuth popup)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --get "${CONTROL_PLANE_URL}/connect" \
  --data-urlencode "app_id=${APP_ID}" \
  --data-urlencode "redirect_uri=${REDIRECT_CHROMIUM}" \
  --data-urlencode "source_id=browser_visits" \
  --data-urlencode "scopes=activity:read,activity:write" \
  --data-urlencode "state=smoke-test")
if [[ "$HTTP" == "302" ]]; then pass "connect accepts chromiumapp redirect (HTTP $HTTP)"; else fail "connect chromiumapp redirect (HTTP $HTTP, want 302)"; fi

echo "2) GET /connect (chrome-extension options redirect)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --get "${CONTROL_PLANE_URL}/connect" \
  --data-urlencode "app_id=${APP_ID}" \
  --data-urlencode "redirect_uri=${REDIRECT_OPTIONS}" \
  --data-urlencode "source_id=browser_visits" \
  --data-urlencode "scopes=activity:read,activity:write" \
  --data-urlencode "state=smoke-test")
if [[ "$HTTP" == "302" ]]; then pass "connect accepts options.html redirect (HTTP $HTTP)"; else fail "connect options redirect (HTTP $HTTP, want 302)"; fi

echo "3) POST /connect/exchange (invalid code — expect exchange_code_invalid, not auth error)"
BODY=$(curl -s -X POST "${CONTROL_PLANE_URL}/connect/exchange" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"invalid-smoke-code\",\"app_id\":\"${APP_ID}\",\"client_secret\":\"${CLIENT_SECRET}\"}")
ERR=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "")
if [[ "$ERR" == "exchange_code_invalid" ]]; then
  pass "exchange reached code validation (error=$ERR)"
else
  fail "exchange unexpected response: $BODY"
fi

if [[ -n "$ADMIN_KEY" ]]; then
  echo "4) GET /v1/apps/browser-plugin (admin — secret fingerprint + redirect allowlist)"
  APP_JSON=$(curl -s -H "Authorization: Bearer ${ADMIN_KEY}" "${CONTROL_PLANE_URL}/v1/apps/${APP_ID}")
  python3 - <<PY
import json, os, sys
app = json.loads('''$APP_JSON''')
meta = app.get("metadata") or {}
prefix = meta.get("client_secret_prefix") or ""
last4 = meta.get("client_secret_last4") or ""
secret = os.environ["CLIENT_SECRET"]
redirects = meta.get("allowed_redirect_uris") or []
checks = [
    ("prefix", prefix == secret[:8]),
    ("last4", last4 == secret[-4:]),
    ("chromium redirect", "$REDIRECT_CHROMIUM" in redirects),
    ("options redirect", "$REDIRECT_OPTIONS" in redirects),
]
for name, ok in checks:
    print(f"  {'PASS' if ok else 'FAIL'}: {name}" + ("" if ok else f" (got prefix={prefix} last4={last4})"))
    sys.exit(1) if not ok and name in ("prefix", "last4") else None
PY
  pass "admin app registry checks (see above)"
else
  echo "4) SKIP admin registry (set CONTROL_PLANE_ADMIN_KEY to verify secret fingerprint on server)"
fi

echo ""
echo "Summary: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
echo "OAuth attach itself was not run — paste CLIENT_SECRET into extension Options and click Attach Dialogues."
