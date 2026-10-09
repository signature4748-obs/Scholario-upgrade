# Scholario — Sandbox v2 Rebuild (parallel artifact)

This branch is a **standalone rebuild** of the Scholario school OS produced in an isolated
sandbox workspace on 2026-10-09. It is NOT connected to the production codebase on `main`
(different storage: SQLite vs Supabase Postgres; single-plane single-page architecture).
It preserves the product's domain model, roles (Principal / Teacher / Student), design
language (teal accent, Sora display, light-first), and the Hawkings demo tenant identity.

- Run: `bun install && bunx prisma db push && bun prisma/seed.ts && bun run dev`
- Demo door: arjun.malhotra@hhsp.edu.in / Hawkings@2026 (also teacher + student one-click doors)
- See worklog.md for the full build log and the MODULE PATTERN GUIDE.

Do not merge into `main` — it is kept as a durable checkpoint / design reference only.
