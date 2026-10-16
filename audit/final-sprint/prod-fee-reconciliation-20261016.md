# Production Fee Reconciliation — Read-Only Evidence (2026-10-16)

Channel: Supabase PostgREST (service role key, read-only GETs).
Direct 5432 egress is sandbox-blocked; Management API tokens returned 401 at
verification time (the first /v1/projects call of the session succeeded; the
channel then became invalid — PostgREST is the evidence channel of record).

## 1. Ledger totals (all schools, live values)

| Measure | Value |
|---|---|
| Fee.paid total (324 Fee rows) | ₹589,020 |
| FeeTransaction SUCCESS total (218 rows) | ₹595,820 |
| Payment SUCCESS total (218 rows) | ₹595,820 |
| FeeTransaction ↔ Payment delta | **₹0** (perfect agreement) |
| Fee.paid ↔ ledger delta | **−₹6,800** |

## 2. The ₹6,800 — exact composition (the 3 dangling feeId rows)

All three are Hawkings High School (`cmupn9zz90001mywak4gyqeb7`), SUCCESS
ledger entries with receipt numbers, `studentId` NULL, refs prefixed
`HHS-TT-2026-0999` (tenant-test corpus — the parent Student and its Fee rows
were cascade-deleted while the ledger survived because `feeId` had no FK):

| FeeTransaction.id | dangling feeId | amount | method | reference |
|---|---|---|---|---|
| cmuqz45gi04f6otzjxcqvutjh | cmuqz458u04f2otzjcp16xg9p | ₹2,500 | CASH | HHS-TT-2026-0999-ANN |
| cmuqz45s004fcotzjubwhyl1j | cmuqz45kc04f8otzj9qxuye12 | ₹4,000 | UPI  | HHS-TT-2026-0999-TUI-T1 |
| cmuqz463h04fiotzj9hyio9tu | cmuqz45vu04feotzjnoux1n4q | ₹300  | CASH | HHS-TT-2026-0999-EXA-T1 |

₹2,500 + ₹4,000 + ₹300 = **₹6,800 — the entire discrepancy**. The Fee.paid
side cannot include collections whose Fee rows no longer exist; the ledger
side keeps the full history. Both ledgers are internally consistent.

## 3. Intended repair (from the pending migration, unchanged position)

`20261013140000_fee_transaction_dangling_feeid_self_heal`:
- Suspends the tenant-guard trigger transactionally, sets `feeId = NULL` on
  exactly these school-scoped dangling rows, re-enables the trigger (any
  failure rolls back to enabled).
- Adds `FeeTransaction_feeId_fkey` → Fee(id) ON DELETE SET NULL ON UPDATE
  CASCADE so no future Fee deletion can strand a pointer.
- **No amount, receipt number, or row is altered or deleted.** The ₹6,800
  ledger evidence is preserved byte-for-byte; the discrepancy is explained,
  not concealed.

## 4. Migration status (verified by schema probes)

| Migration | Status | Evidence |
|---|---|---|
| 20261013140000 self-heal | PENDING | the 3 dangling feeIds are still present (an applied heal + FK would have detached them) |
| 20261013183000 subscription_entitlement_system | PENDING | `subscription_entitlements` / `plan_registry` → HTTP 404 (tables absent) |

## 5. Tenant isolation

0 cross-tenant pointers among all 226 live feeId references (checked
Fee.schoolId ↔ FeeTransaction.schoolId for every live ref).
