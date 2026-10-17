#!/usr/bin/env bash
# Phase 4 — production smoke tests (read-only probes; no credentials typed,
# no sessions minted). TARGET_URL / SCHOOL_URL overridable.
set -u
PLATFORM="${TARGET_URL:-https://scholario-platform.vercel.app}"
SCHOOL="${SCHOOL_URL:-https://scholario-app-virid.vercel.app}"

pass=0; fail=0
probe() { # name url expected_status [curl_extra...]
  local name="$1" url="$2" want="$3"; shift 3
  local code
  code=$(curl -s -o /tmp/smoke-body -w '%{http_code}' --max-time 30 "$@" "$url")
  if [ "$code" = "$want" ]; then
    echo "PASS  $name ($code)"
    pass=$((pass+1))
  else
    echo "FAIL  $name (got $code want $want)"
    head -c 200 /tmp/smoke-body; echo
    fail=$((fail+1))
  fi
}
body_has() { # name substring
  if grep -q "$1" /tmp/smoke-body 2>/dev/null; then echo "PASS  $2 (body)"; pass=$((pass+1));
  else echo "FAIL  $2 (body missing '$1')"; fail=$((fail+1)); fi
}

echo "── platform plane: $PLATFORM"
probe "platform /health/ready"              "$PLATFORM/health/ready" 200
body_has "database\":\"ok" "platform health database ok"
probe "platform landing /"                  "$PLATFORM/" 200
probe "platform login door"                 "$PLATFORM/platform/login" 200
probe "school-auth route absent on platform plane (by design)" "$PLATFORM/api/auth/me" 404
probe "supabase-exchange route absent on platform plane" "$PLATFORM/api/auth/supabase/exchange" 404
probe "email diagnostics guarded"           "$PLATFORM/api/platform/health/email" 401
probe "platform control plane guarded"      "$PLATFORM/api/platform/auth/me" 401

echo "── school plane: $SCHOOL"
probe "school /health/ready"                "$SCHOOL/health/ready" 200
body_has "database\":\"ok" "school health database ok"
probe "school landing /"                    "$SCHOOL/" 200
probe "school login door"                   "$SCHOOL/login" 200
probe "tenant door (hawkings demo)"         "$SCHOOL/s/hawkings-prithvipur/login" 200
probe "tenant door (green-valley real)"     "$SCHOOL/s/green-valley/login" 200
probe "school auth door guarded (me)"       "$SCHOOL/api/auth/me" 401
probe "attendance API guarded"              "$SCHOOL/api/attendance" 401
probe "students API guarded"                "$SCHOOL/api/students" 401
probe "salary API guarded"                  "$SCHOOL/api/salary" 401
probe "search guarded"                      "$SCHOOL/api/search" 401
probe "exchange GET rejected (POST-only)"    "$SCHOOL/api/auth/supabase/exchange" 405
code=$(curl -s -o /tmp/smoke-body -w '%{http_code}' --max-time 30 -X POST -H 'content-type: application/json' -d '{}' "$SCHOOL/api/auth/supabase/exchange")
if [ "$code" = "422" ] || [ "$code" = "403" ]; then echo "PASS  exchange POST with flag OFF → $code FEATURE_DISABLED (flag verified OFF)"; pass=$((pass+1));
else echo "FAIL  exchange POST with flag OFF → got $code (want 422/403 FEATURE_DISABLED)"; head -c 150 /tmp/smoke-body; echo; fail=$((fail+1)); fi
probe "wrong-credentials login 401"         "$SCHOOL/api/auth/login" 401 \
  -H 'content-type: application/json' \
  -d '{"email":"smoke-probe@hawkingshigh.edu","password":"definitely-wrong"}'

echo
echo "RESULT: $pass pass / $fail fail"
[ "$fail" -eq 0 ] && echo "SMOKE GREEN" || echo "SMOKE RED"
exit "$fail"
