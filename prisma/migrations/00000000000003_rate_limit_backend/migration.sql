-- PHASE 8A — DB-backed rate limiting (multi-instance-safe budgets).
-- Fixed-window counters, single-row-per-key, written only via the atomic
-- upsert in src/lib/security/rate-limit.ts. Bounded state: expired rows
-- are pruned lazily on access and swept periodically by the event-stream
-- poller. RLS enabled (deny-by-default, like every app table).
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "RateLimitBucket" ENABLE ROW LEVEL SECURITY;
