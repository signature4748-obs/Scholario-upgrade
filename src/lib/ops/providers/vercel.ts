/**
 * Vercel provider adapter — PROJECT + DEPLOYMENT facts only.
 *
 * WHAT IS ACTUALLY AVAILABLE (live-verified against the connected team,
 * 2026-10-20, team plan: Hobby):
 *   · GET /v9/projects — the real connected projects, their production
 *     domains and latest deployment per project.
 *   · GET /v6/deployments — real deployment history with state
 *     (READY / ERROR / CANCELED / …), commit SHAs and URLs. This is the
 *     source for "latest successful deployment" and the failed-build
 *     evidence cards on the Overview tab.
 *   · GET /v9/projects/{id}/domains — verified production domains.
 *
 * WHAT IS NOT AVAILABLE (verified live: HTTP 400
 * `plan_upgrade_required` — "This API endpoint is only available to
 * Teams on the Pro or Enterprise plan"):
 *   · GET /v1/usage (bandwidth, function invocations, etc.)
 *   · Per-project usage breakdowns.
 * The adapter records these as `plan-restricted` unavailable metrics so
 * the UI can show "Not available through the connected API/plan" with a
 * link to the Vercel usage dashboard — the operator sees real project
 * facts + real deployments, and honest unavailability for usage numbers.
 *
 * Credentials: OPS_VERCEL_TOKEN (server-only). Unset → adapter reports
 * `not-configured` (the dashboard renders the reason; nothing crashes).
 */

import { opsFetch, OpsFetchError } from '../fetch'
import type { MetricSample, ProviderDeploymentSummary, ProviderSyncResult, UnavailableMetric } from '../types'

const API = 'https://api.vercel.com'

interface VercelProject {
  id: string
  name: string
  accountId?: string
  targets?: { production?: { url?: string; readyState?: string; createdAt?: number } }
}

interface VercelDeployment {
  uid: string
  name?: string
  state?: string
  ready?: number
  created?: number
  url?: string
  projectId?: string
  meta?: { githubCommitSha?: string; githubCommitMessage?: string }
}

export function vercelConfigured(): boolean {
  return (process.env.OPS_VERCEL_TOKEN ?? '').trim().length > 0
}

function token(): string {
  return (process.env.OPS_VERCEL_TOKEN ?? '').trim()
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token()}` }
}

function teamQuery(): string {
  const teamId = (process.env.OPS_VERCEL_TEAM_ID ?? '').trim()
  return teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''
}

/**
 * The list of projects to report on: the explicit OPS_VERCEL_PROJECTS
 * env (comma-separated ids or names) when set, else EVERY project the
 * token can see (the two production planes on the connected team).
 */
async function listProjects(): Promise<VercelProject[]> {
  const body = (await opsFetch(`${API}/v9/projects?limit=100`, {
    headers: authHeaders(),
    timeoutMs: 8_000,
  })) as { projects?: VercelProject[] }
  return Array.isArray(body?.projects) ? body.projects : []
}

function deploymentSummary(p: VercelProject, d: VercelDeployment): ProviderDeploymentSummary {
  return {
    provider: 'vercel',
    projectId: p.id,
    projectName: d.name ?? p.name,
    deploymentId: d.uid,
    state: (d.state ?? 'UNKNOWN').toUpperCase(),
    createdAt: d.created ? new Date(d.created).toISOString() : null,
    commitSha: d.meta?.githubCommitSha ?? null,
    commitMessage: d.meta?.githubCommitMessage ? d.meta.githubCommitMessage.slice(0, 200) : null,
    url: d.url ? `https://${d.url}` : null,
  }
}

/** Live Vercel deployment sync (called by the sync service). */
export async function syncVercel(): Promise<ProviderSyncResult> {
  if (!vercelConfigured()) {
    return {
      provider: 'vercel',
      samples: [],
      unavailable: [
        {
          provider: 'vercel',
          scope: 'account',
          scopeLabel: 'Vercel account',
          metric: 'all_usage_metrics',
          metricLabel: 'Requests · bandwidth · invocations · build minutes',
          reason: 'not-configured',
          detail:
            'OPS_VERCEL_TOKEN is not set in the server environment. Add the read-only Vercel API token to the deployment env to enable project and deployment telemetry.',
        },
      ],
      deployments: [],
    }
  }

  const samples: MetricSample[] = []
  const unavailable: UnavailableMetric[] = []
  const deploymentsOut: ProviderDeploymentSummary[] = []

  try {
    const projects = await listProjects()
    const selectedNames = (process.env.OPS_VERCEL_PROJECTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const selected = selectedNames.length
      ? projects.filter((p) => selectedNames.includes(p.id) || selectedNames.includes(p.name))
      : projects

    for (const p of selected) {
      const scope = `project:${p.id}`
      const label = `Vercel project · ${p.name}`
      samples.push({
        provider: 'vercel',
        scope,
        scopeLabel: label,
        metric: 'project_exists',
        metricLabel: 'Project reachable through the API',
        value: 1,
        unit: 'count',
        limitValue: null,
        measured: true,
        availability: 'ok',
        meta: { productionDomain: p.targets?.production?.url ?? null },
      })

      // Real deployment facts: latest production deployments + failures.
      // ONE paged call per project serves both the metric samples and the
      // deployment summary list (bounded: 20 most recent).
      const depsBody = (await opsFetch(
        `${API}/v6/deployments?projectId=${encodeURIComponent(p.id)}&limit=20&target=production${teamQuery()}`,
        { headers: authHeaders(), timeoutMs: 8_000 },
      )) as { deployments?: VercelDeployment[] }
      const deployments = Array.isArray(depsBody?.deployments) ? depsBody.deployments : []

      const failed = deployments.filter((d) => (d.state ?? '').toUpperCase() === 'ERROR')
      const latest = deployments[0] ?? null

      // Real deployment history for the Overview cards + drill-downs.
      for (const d of deployments.slice(0, 5)) {
        deploymentsOut.push(deploymentSummary(p, d))
      }

      samples.push({
        provider: 'vercel',
        scope,
        scopeLabel: label,
        metric: 'deployments_failed_total_recent',
        metricLabel: 'Failed production deployments in the recent window',
        value: failed.length,
        unit: 'count',
        limitValue: null,
        measured: true,
        availability: 'ok',
        meta: { windowSize: deployments.length },
      })

      if (latest) {
        samples.push({
          provider: 'vercel',
          scope,
          scopeLabel: label,
          metric: 'latest_deployment_state',
          metricLabel: 'Latest production deployment state',
          value: (latest.state ?? 'UNKNOWN').toUpperCase() === 'READY' ? 1 : 0,
          unit: 'count',
          limitValue: null,
          measured: true,
          availability: 'ok',
          meta: {
            state: (latest.state ?? 'UNKNOWN').toUpperCase(),
            uid: latest.uid,
            commitSha: latest.meta?.githubCommitSha ?? null,
            createdAt: latest.created ? new Date(latest.created).toISOString() : null,
          },
        })
      }
    }

    // Honest plan restriction (verified live on this team).
    unavailable.push({
      provider: 'vercel',
      scope: 'account',
      scopeLabel: 'Vercel account',
      metric: 'usage_metrics',
      metricLabel: 'Requests · bandwidth · function invocations · build minutes',
      reason: 'plan-restricted',
      detail:
        'The Vercel usage API is only available to Teams on the Pro or Enterprise plan (the provider rejects the request with plan_upgrade_required). View usage in the Vercel dashboard: vercel.com/usage',
    })

    return { provider: 'vercel', samples, unavailable, deployments: deploymentsOut }
  } catch (e) {
    const detail =
      e instanceof OpsFetchError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e)
    return {
      provider: 'vercel',
      samples: [],
      unavailable: [],
      deployments: [],
      error: `Vercel API unreachable: ${detail.slice(0, 200)}`,
    }
  }
}
