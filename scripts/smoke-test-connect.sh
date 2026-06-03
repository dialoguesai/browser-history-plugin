#!/usr/bin/env bash
# Smoke-test browser-plugin Grant Access wiring against Control Plane (PKCE, no client secret).
#
# Usage:
#   CONTROL_PLANE_URL=https://cp.logu3s.com \
#   EXTENSION_ID=nhchpdllklekegfalgklbeedainhjjif \
#   ./scripts/smoke-test-connect.sh
#
# Registers redirects via public API, then validates /connect accepts them.

set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://cp.logu3s.com}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL%/}"
APP_ID="${APP_ID:-browser-plugin}"
EXTENSION_ID="${EXTENSION_ID:?Set EXTENSION_ID (from chrome://extensions)}"
ADMIN_KEY="${CONTROL_PLANE_ADMIN_KEY:-}"

REDIRECT_CHROMIUM="https://${EXTENSION_ID}.chromiumapp.org/"
REDIRECT_OPTIONS="chrome-extension://${EXTENSION_ID}/options.html"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "Control Plane: $CONTROL_PLANE_URL"
echo "Extension ID:  $EXTENSION_ID"
echo ""

eval "$(python3 -c 'import base64,hashlib,secrets; v=secrets.token_urlsafe(48); c=base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip("="); print(f"VERIFIER={v}"); print(f"CHALLENGE={c}")')"

echo "0) POST extension-install/redirects"
REG=$(curl -s -w "\n%{http_code}" -X POST \
  "${CONTROL_PLANE_URL}/v1/apps/${APP_ID}/extension-install/redirects" \
  -H "Content-Type: application/json" \
  -d "{\"extension_id\":\"${EXTENSION_ID}\"}")
REG_HTTP=$(echo "$REG" | tail -n1)
if [[ "$REG_HTTP" == "200" ]]; then pass "extension-install/redirects (HTTP $REG_HTTP)"; else fail "extension-install/redirects (HTTP $REG_HTTP)"; fi

echo "1) GET /connect (chromiumapp + PKCE)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --get "${CONTROL_PLANE_URL}/connect" \
  --data-urlencode "app_id=${APP_ID}" \
  --data-urlencode "redirect_uri=${REDIRECT_CHROMIUM}" \
  --data-urlencode "source_id=browser_visits" \
  --data-urlencode "scopes=activity:write" \
  --data-urlencode "code_challenge=${CHALLENGE}" \
  --data-urlencode "code_challenge_method=S256" \
  --data-urlencode "state=smoke-test")
if [[ "$HTTP" == "302" ]]; then pass "connect chromiumapp + PKCE (HTTP $HTTP)"; else fail "connect chromiumapp (HTTP $HTTP)"; fi

echo "2) GET /connect (options.html redirect + PKCE)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --get "${CONTROL_PLANE_URL}/connect" \
  --data-urlencode "app_id=${APP_ID}" \
  --data-urlencode "redirect_uri=${REDIRECT_OPTIONS}" \
  --data-urlencode "source_id=browser_visits" \
  --data-urlencode "scopes=activity:write" \
  --data-urlencode "code_challenge=${CHALLENGE}" \
  --data-urlencode "code_challenge_method=S256" \
  --data-urlencode "state=smoke-test")
if [[ "$HTTP" == "302" ]]; then pass "connect options redirect + PKCE (HTTP $HTTP)"; else fail "connect options (HTTP $HTTP)"; fi

echo "3) POST /connect/exchange (invalid code — expect exchange_code_invalid)"
BODY=$(curl -s -X POST "${CONTROL_PLANE_URL}/connect/exchange" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"invalid-smoke-code\",\"app_id\":\"${APP_ID}\",\"code_verifier\":\"${VERIFIER}\"}")
ERR=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "")
if [[ "$ERR" == "exchange_code_invalid" ]]; then
  pass "exchange reached code validation (error=$ERR)"
else
  fail "exchange unexpected: $BODY"
fi

if [[ -n "$ADMIN_KEY" ]]; then
  echo "4) GET /v1/apps/browser-plugin (redirect allowlist)"
  APP_JSON=$(curl -s -H "Authorization: Bearer ${ADMIN_KEY}" "${CONTROL_PLANE_URL}/v1/apps/${APP_ID}")
  python3 - <<PY
import json, sys
app = json.loads("""$APP_JSON""")
redirects = (app.get("metadata") or {}).get("allowed_redirect_uris") or []
for name, uri in [
    ("chromium redirect", "$REDIRECT_CHROMIUM"),
    ("options redirect", "$REDIRECT_OPTIONS"),
]:
    ok = uri in redirects
    print(f"  {'PASS' if ok else 'FAIL'}: {name}")
    if not ok:
        sys.exit(1)
PY
  pass "admin redirect allowlist"
else
  echo "4) SKIP admin registry (optional CONTROL_PLANE_ADMIN_KEY)"
fi

echo ""
echo "Summary: $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
echo "Load extension, open Options (Topos tab), click Attach Dialogues to complete OAuth."
