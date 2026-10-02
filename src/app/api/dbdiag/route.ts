/**
 * TEMPORARY diagnostic route — DB connection probe (reverted immediately
 * after use). Returns error classes/messages ONLY; the connection string
 * and password are never echoed.
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN = 'diag-7f3a9c2e1b'

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('t') !== TOKEN) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const out: Record<string, unknown> = {}

  // 1. App's Prisma client probe
  try {
    const t0 = Date.now()
    await db.$queryRaw`SELECT 1`
    out.prisma = { ok: true, ms: Date.now() - t0 }
  } catch (e: any) {
    out.prisma = { ok: false, name: e?.name ?? '?', code: e?.code ?? null, message: (e?.message ?? '').split('\n')[0].slice(0, 300) }
  }

  // 2. Raw pg probe with the same URL (redacted diagnostics)
  try {
    const { Client } = await import('pg')
    const raw = process.env.DATABASE_URL ?? ''
    const t1 = Date.now()
    const c = new Client({ connectionString: raw, connectionTimeoutMillis: 4000 })
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    out.rawPg = { ok: true, ms: Date.now() - t1 }
  } catch (e: any) {
    out.rawPg = { ok: false, name: e?.name ?? '?', code: e?.code ?? null, message: (e?.message ?? '').split('\n')[0].slice(0, 300) }
  }

  // 3. DNS + TCP shape of the DB host (no credentials)
  try {
    const raw = new URL((process.env.DATABASE_URL ?? '').replace('postgresql://', 'http://'))
    const host = raw.hostname
    const port = Number(raw.port || 5432)
    const { lookup } = await import('dns/promises')
    const addrs = await lookup(host, { all: true })
    const net = await import('net')
    const tcpMs = await new Promise<number | string>((resolve) => {
      const t2 = Date.now()
      const s = net.createConnection({ host, port })
      s.setTimeout(2500)
      s.on('connect', () => { s.destroy(); resolve(Date.now() - t2) })
      s.on('timeout', () => { s.destroy(); resolve('timeout') })
      s.on('error', (err: any) => resolve('err:' + (err?.code ?? err?.message ?? '?')))
    })
    out.net = { host, port, dns: addrs.map((a) => a.address), tcp: tcpMs }
  } catch (e: any) {
    out.net = { ok: false, message: (e?.message ?? '').split('\n')[0].slice(0, 200) }
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
