#!/usr/bin/env bash
# scripts/dev-env.sh — export the LOCAL dev database env into the current
# shell. MUST be sourced, not executed:
#
#     source scripts/dev-env.sh
#
# WHY THIS EXISTS (2026-10-16 workspace recovery — see
# audit/RECOVERY-20261016/REPORT.md): the sandbox injects
# DATABASE_URL=<sqlite template> into every tool shell session, and real
# environment variables override dotenv in Prisma CLI, Prisma Client and
# bun. Every DB-touching command run from a tool shell therefore silently
# resolved the SQLite URL and failed (P1012 "URL must start with
# postgresql://" / opaque connect errors) even with a correct .env file.
# The `dev` npm script sources this file so the dev server is immune; any
# prisma CLI invocation still needs an explicit `source scripts/dev-env.sh`.
#
# CI-SAFETY: an ambient DATABASE_URL that is already a postgres:// URL is
# NEVER clobbered and no .env file is ever written when one is already
# provided by the environment (the CI job and production set their own
# correct values at the environment level — this helper must not override
# or materialize files there).
#
# If .env is missing (a container reset wipes it — the startup script
# re-clobbers it with the SQLite template), it is reconstructed from the
# CI-documented job-local default in .github/workflows/ci.yml (database
# name adjusted to the local embedded cluster's `scholario`), with
# DATABASE_ENV=test and REALTIME_MODE=disabled matching CI exactly.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

is_postgres_url() {
  case "$1" in postgresql://*|postgres://*) return 0 ;; *) return 1 ;; esac
}

if [ ! -f "$ROOT/.env" ] && ! is_postgres_url "${DATABASE_URL:-}"; then
  URL="$(grep -oE 'postgresql://[^"]+' "$ROOT/.github/workflows/ci.yml" | head -1 | sed 's#/postgres?#/scholario?#')"
  if [ -z "$URL" ]; then
    echo "dev-env: FATAL — no .env and could not derive the postgres URL from .github/workflows/ci.yml" >&2
    return 1 2>/dev/null || exit 1
  fi
  printf 'DATABASE_URL=%s\nDATABASE_ENV=test\nREALTIME_MODE=disabled\n' "$URL" > "$ROOT/.env"
  echo "dev-env: reconstructed $ROOT/.env from the CI-documented default" >&2
fi

if [ -f "$ROOT/.env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in ''|'#'*) continue ;; esac
    # Never clobber an ambient postgres DATABASE_URL (CI/production own it).
    if [ "$k" = "DATABASE_URL" ] && is_postgres_url "${DATABASE_URL:-}"; then
      continue
    fi
    export "$k=$v"
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env")
fi

echo "dev-env: DATABASE_URL scheme: ${DATABASE_URL%%://*}" >&2
