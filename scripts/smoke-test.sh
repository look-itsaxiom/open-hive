#!/bin/bash
set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"

echo "=== Open Hive Smoke Test ==="
echo "Backend: $BACKEND_URL"
echo ""

# Health check
echo "1. Health check..."
HEALTH=$(curl -sf "$BACKEND_URL/api/health")
echo "$HEALTH" | grep -q '"ok"'
echo "   PASS — $HEALTH"

# Register two sessions
echo "2. Register session A (Chase)..."
REG_A=$(curl -sf -X POST "$BACKEND_URL/api/sessions/register" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-a","developer_email":"chase@test.com","developer_name":"Chase","repo":"tapcheck-hr","project_path":"/code/tapcheck-hr"}')
echo "$REG_A" | grep -q '"ok":true'
echo "   PASS"

echo "3. Register session B (Sarah)..."
REG_B=$(curl -sf -X POST "$BACKEND_URL/api/sessions/register" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-b","developer_email":"sarah@test.com","developer_name":"Sarah","repo":"tapcheck-hr","project_path":"/code/tapcheck-hr"}')
echo "$REG_B" | grep -q '"ok":true'
echo "   PASS"

# Send intent signals
echo "4. Chase declares intent: 'fix auth token refresh bug'..."
INTENT_A=$(curl -sf -X POST "$BACKEND_URL/api/signals/intent" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-a","content":"fix auth token refresh bug","type":"prompt"}')
echo "$INTENT_A" | grep -q '"ok":true'
echo "   PASS"

echo "5. Sarah declares intent: 'fix auth token expiry logic'..."
INTENT_B=$(curl -sf -X POST "$BACKEND_URL/api/signals/intent" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-b","content":"fix auth token expiry logic","type":"prompt"}')
echo "$INTENT_B" | grep -q '"ok":true'
# Check if semantic collision was detected
if echo "$INTENT_B" | grep -q '"semantic"'; then
  echo "   PASS — SEMANTIC COLLISION DETECTED (L3a keyword overlap)"
else
  echo "   PASS — no semantic collision (keywords may not overlap enough)"
fi

# Chase modifies a file
echo "6. Chase modifies auth/token-service.ts..."
ACT_A=$(curl -sf -X POST "$BACKEND_URL/api/signals/activity" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-a","file_path":"auth/token-service.ts","type":"file_modify"}')
echo "$ACT_A" | grep -q '"ok":true'
echo "   PASS"

# Sarah modifies the same file -> should get L1 collision
echo "7. Sarah modifies auth/token-service.ts (expect collision)..."
ACT_B=$(curl -sf -X POST "$BACKEND_URL/api/signals/activity" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-b","file_path":"auth/token-service.ts","type":"file_modify"}')
echo "$ACT_B" | grep -q '"critical"'
echo "   PASS — FILE COLLISION DETECTED (L1 critical)"

# List active sessions
echo "8. List active sessions..."
ACTIVE=$(curl -sf "$BACKEND_URL/api/sessions/active")
echo "$ACTIVE" | grep -q '"Chase"'
echo "$ACTIVE" | grep -q '"Sarah"'
echo "   PASS — both sessions active"

# Check conflicts endpoint (requires file_path and session_id)
echo "9. Check conflicts for session A on auth/token-service.ts..."
CONFLICTS=$(curl -sf "$BACKEND_URL/api/conflicts/check?session_id=smoke-a&file_path=auth/token-service.ts")
echo "$CONFLICTS" | grep -q '"has_conflicts":true'
echo "   PASS — conflict visible"

# Resolve the collision
echo "10. Resolve the file collision..."
COLLISION_ID=$(echo "$ACT_B" | sed 's/.*"collision_id":"\([^"]*\)".*/\1/' | head -1)
if [ -n "$COLLISION_ID" ]; then
  curl -sf -X POST "$BACKEND_URL/api/conflicts/resolve" \
    -H 'Content-Type: application/json' \
    -d "{\"collision_id\":\"$COLLISION_ID\",\"resolved_by\":\"sarah@test.com\"}"
  echo "   PASS — collision resolved"
else
  echo "   SKIP — could not extract collision_id (checking via conflicts endpoint)"
fi

# End sessions
echo "11. Cleanup — ending sessions..."
curl -sf -X POST "$BACKEND_URL/api/sessions/end" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-a"}'
curl -sf -X POST "$BACKEND_URL/api/sessions/end" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-b"}'
echo "   PASS"

# Verify sessions ended
echo "12. Verify sessions ended..."
FINAL=$(curl -sf "$BACKEND_URL/api/sessions/active?repo=tapcheck-hr")
if echo "$FINAL" | grep -q '"smoke-a"'; then
  echo "   FAIL — session A still active"
  exit 1
fi
echo "   PASS — sessions cleaned up"

echo ""
echo "=== ALL TESTS PASSED ==="
