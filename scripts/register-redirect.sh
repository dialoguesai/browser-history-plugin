#!/usr/bin/env bash
# Register this Chrome extension install's OAuth redirect URIs on Control Plane.
# Prefer automatic registration from the extension Options page; use this for CI/debug.
#
# Usage:
#   CONTROL_PLANE_URL=https://cp.logu3s.com EXTENSION_ID=abcdef... ./scripts/register-redirect.sh
#
# Or let the extension register itself (open Options once after load).

set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://cp.logu3s.com}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL%/}"
EXTENSION_ID="${EXTENSION_ID:?Set EXTENSION_ID from chrome://extensions}"

BODY=$(printf '{"extension_id":"%s"}' "$EXTENSION_ID")
RESP=$(curl -s -w "\n%{http_code}" -X POST \
  "${CONTROL_PLANE_URL}/v1/apps/browser-history-plugin/extension-install/redirects" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP=$(echo "$RESP" | tail -n1)
JSON=$(echo "$RESP" | sed '$d')

echo "HTTP $HTTP"
echo "$JSON" | python3 -m json.tool 2>/dev/null || echo "$JSON"

if [[ "$HTTP" != "200" ]]; then
  exit 1
fi

echo "OK: redirect URIs registered for extension $EXTENSION_ID"
