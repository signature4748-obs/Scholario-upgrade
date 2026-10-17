# Vercel storage-allocation support request (prepared — FILE ONLY IF DASHBOARD CONFIRMS AN ORPHANED ALLOCATION)

> Prepared 2026-10-13 by the final-closure audit. DO NOT file this request
> unless the owner's dashboard check (Steps 1–2 below) actually shows storage
> usage that cannot be attributed to the two live projects. The usage API is
> Hobby-plan-gated, so only the owner can see the meters.

## Step 1 — Owner: verify whether an orphaned allocation exists (dashboard only)

1. Open the Vercel dashboard → team "signature4748-2940's projects" →
   **Usage** (and each project's Storage tab).
2. Compare the storage figures against what the two live projects plausibly
   hold (see evidence below). Anything not attributable to
   `scholario-app` / `scholario-platform` — especially storage persisted from
   the deleted `scholario-production` project — is the orphan.

## Step 2 — What the API could and could not establish (attach as evidence)

API-VERIFIED FACTS (2026-10-13, read-only):

- Team: `team_hCzBj3bYUQgDxKf6MhpY5N0r` ("signature4748-2940's projects") —
  Hobby plan (usage meters API-gated: `GET /v1/usage` returns
  "This API endpoint is only available to Teams on the Pro or Enterprise
  plan", HTTP 400).
- Exactly TWO live projects exist in the team:
  - `scholario-app` (prj_oiKZtuC7UgOSsShQ63MWxS5nWu53)
  - `scholario-platform` (prj_gIO4DmWcBkHMhwkVpmzqqHNWU0MW)
- The legacy `scholario-production` project was deleted (2026-10-12/13
  hardening batch) and no longer appears in the project list.
- Deployment inventory per live project at audit time: 12 READY production
  deployments each (rollback candidates 2026-10-12 → 2026-10-13, deliberately
  retained) + 1 in-flight preview. Rollback deployments were NOT deleted as a
  storage shortcut.
- Billing/invoices endpoint: not accessible with the current token (404).

API CANNOT ESTABLISH (Hobby plan limitation — this is why the owner must
check the dashboard): total Deployment/Functions/Artifacts storage bytes,
per-project storage attribution, and whether the deleted
`scholario-production` project left storage billed to the team.

## Step 3 — If an orphaned allocation is confirmed, file this text with Vercel support

Subject: Request to release storage allocation orphaned by a deleted project (Hobby team)

Body:
> Team: "signature4748-2940's projects" (team_hCzBj3bYUQgDxKf6MhpY5N0r), Hobby plan.
> On 2026-10-12/13 we deleted a legacy project (`scholario-production`) as
> part of consolidation to exactly two canonical projects (`scholario-app`,
> `scholario-platform`). Our dashboard shows storage usage that cannot be
> attributed to either live project (see figures from our Usage page: …).
> We deliberately did NOT delete rollback deployments of the live projects.
> Please confirm whether storage persisted from the deleted project remains
> billed to the team and, if so, release it. Happy to provide any additional
> verification you need.

## Guardrails honored

- No rollback deployments deleted (explicitly out of scope).
- No projects, deployments, or records deleted by this audit.
- No paid-plan or billing settings changed.
