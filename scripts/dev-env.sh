#!/usr/bin/env bash
# scripts/local-dev-env.sh — export the LOCAL dev database env into the
# current shell. MUST be sourced, not executed:
#
#     source scripts/local-dev-env.sh
#
# WHY THIS EXISTS (2026-10-16 workspace recovery — see
# audit/RECOVERY-20261016/REPORT.md): the sandbox injects
# DATABASE_URL=<sqlite template> into every tool shell session, and real
# environment variables override dotenv in Prisma CLI, Prisma Client and
# bun. Every DB-touching command run from a tool shell therefore silently
# resolved the SQLite URL and failed (P1012 "URL must start with
# postgresql://" / opaque connect errors) even with a correct .env file.
# Sourcing this file re-exports the repo .env values over the injection.
#
# If .env is missing (a container reset wipes it — the startup script
# re-clobbers it with the SQLite template), it is reconstructed from the
# CI-documented job-local default in .github/workflows/ci.yml (database
# name adjusted to the local embedded cluster's `scholario`), with
# DATABASE_ENV=test and REALTIME_MODE=disabled matching CI exactly.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  URL="$(grep -oE 'postgresql://[^"]+' "$ROOT/.github/workflows/ci.yml" | head -1 | sed 's#/postgres?#/scholario?#')"
  if [ -z "$URL" ]; then
    echo "local-dev-env: FATAL — could not derive the postgres URL from .github/workflows/ci.yml" >&2
    return 1 2>/dev/null || exit 1
  fi
  printf 'DATABASE_URL=%s\nDATABASE_ENV=test\nREALTIME_MODE=disabled\n' "$URL" > "$ROOT/.env"
  echo "local-dev-env: reconstructed $ROOT/.env from the CI-documented default" >&2
fi

while IFS='=' read -r k v; do
  case "$k" in ''|'#'*) continue ;; esac
  export "$k=$v"
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env")

echo "local-dev-env: exported $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env") vars (DATABASE_URL scheme: ${DATABASE_URL%%://*})" >&2
