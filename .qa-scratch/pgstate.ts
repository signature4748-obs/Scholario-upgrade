import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const acts = await db.$queryRaw<any[]>`SELECT pid, state, wait_event_type, wait_event, EXTRACT(EPOCH FROM now()-query_start)::int AS running_s, left(query,90) AS query FROM pg_stat_activity WHERE datname='scholario' ORDER BY query_start`;
console.log(JSON.stringify(acts, null, 1));
const counts = await db.$queryRaw<any[]>`SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname='scholario' GROUP BY state`;
console.log(counts);
await db.$disconnect();
