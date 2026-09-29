// One-off backfill: create Payment transaction rows for PAID fees that lack one.
// Makes superadmin platform revenue reflect real collections without a full reseed.
import { db } from '../src/lib/db'

async function main() {
  const paidFees = await db.fee.findMany({
    where: { status: 'PAID', paid: { gt: 0 } },
    include: { payments: { select: { id: true } } },
  })

  let created = 0
  const methods = ['UPI', 'CARD', 'NETBANKING', 'CASH']
  for (const [idx, fee] of paidFees.entries()) {
    if (fee.payments.length > 0) continue
    await db.payment.create({
      data: {
        // Phase 3: Payment.schoolId is required — derived from the fee.
        schoolId: fee.schoolId,
        feeId: fee.id,
        amount: fee.paid,
        method: methods[idx % methods.length],
        status: 'SUCCESS',
        transactionId: `TXN-${fee.id.slice(-8).toUpperCase()}`,
        note: `Backfill for ${fee.title}`,
        createdAt: fee.paidDate ?? fee.createdAt ?? new Date(),
      },
    })
    created++
  }
  console.log(`✅ Backfill complete: ${created} payment rows created for ${paidFees.length} paid fees.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
