import { api, platformLogin, check, summary, section, RUN } from './plib';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const ROOT_EMAIL = 'admin@scholario.cloud';
// read root password from env file
const fs = await import('fs');
const envTxt = fs.readFileSync('/home/z/my-project/.env', 'utf8');
const ROOT_PW = envTxt.match(/^SEED_PLATFORM_ROOT_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')!;

const SLUG = `qa-e2e-${RUN}`;
const CODE = `QA-${RUN.toUpperCase()}`;
const PRINCIPAL_EMAIL = `qa.principal.${RUN}@qafix.scholario.dev`;
const PRINCIPAL_PW = 'QaFix!2026x';

async function main() {
  section('P1.A Root login');
  const { token, status } = await platformLogin(ROOT_EMAIL, ROOT_PW);
  check('root login 200', status === 200, status);
  if (!token) { summary('P1 aborted'); return; }
  const H = token;

  section('P1.B School listing (pre-provision)');
  const list0 = await api('/api/platform/schools?page=1', {}, H);
  check('GET schools 200', list0.status === 200, list0.status);
  check('envelope ok', list0.body?.ok === true);
  check('total number', typeof list0.body?.data?.total === 'number', list0.body?.data?.total);

  section('P1.C Provision QA school');
  const prov = await api('/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA E2E Validation Academy ${RUN}`,
      slug: SLUG,
      code: CODE,
      city: 'QA City',
      board: 'CBSE',
      plan: 'STANDARD',
      billingModel: 'SCHOOL_WIDE',
      principalName: 'QA Principal',
      principalEmail: PRINCIPAL_EMAIL,
      principalPassword: PRINCIPAL_PW,
      authMethod: 'PASSWORD',
      academicYear: '2026-2027',
      classes: [
        { name: 'Grade 5', sections: ['A'] },
        { name: 'Grade 6', sections: ['A', 'B'] },
      ],
      subjects: ['Mathematics', 'Science'],
    }),
  }, H);
  check('POST schools 200/201', prov.status === 200 || prov.status === 201, { status: prov.status, body: prov.body });
  const school = prov.body?.data?.school;
  const principal = prov.body?.data?.principal;
  check('school.id returned', !!school?.id, school);
  check('school.status PENDING', school?.status === 'PENDING', school?.status);
  check('principal returned', !!principal?.id);
  check('bootstrap classes=2', prov.body?.data?.bootstrap?.classes === 2, prov.body?.data?.bootstrap);
  check('bootstrap sections=3', prov.body?.data?.bootstrap?.sections === 3, prov.body?.data?.bootstrap);
  check('tempPassword absent for caller-supplied password', prov.body?.data?.tempPassword === undefined, prov.body?.data?.tempPassword);
  check('mustChangePassword true', prov.body?.data?.mustChangePassword === true);
  const schoolId = school?.id;
  if (!schoolId) { summary('P1 aborted (no school id)'); return; }

  section('P1.D Provision idempotent replay');
  const prov2 = await api('/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA E2E Validation Academy ${RUN}`, slug: SLUG, code: CODE,
      board: 'CBSE', plan: 'STANDARD', billingModel: 'SCHOOL_WIDE',
      principalName: 'QA Principal', principalEmail: PRINCIPAL_EMAIL, authMethod: 'PASSWORD',
    }),
  }, H);
  check('replay flagged', prov2.body?.data?.replayed === true || prov2.body?.data?.school?.id === schoolId, { status: prov2.status, replayed: prov2.body?.data?.replayed });
  const cnt = await db.school.count({ where: { slug: SLUG } });
  check('exactly one school row', cnt === 1, cnt);

  section('P1.E Detail dossier');
  const det = await api(`/api/platform/schools/${schoolId}`, {}, H);
  check('GET detail 200', det.status === 200, det.status);
  check('provisioning state PENDING_ACTIVATION', det.body?.data?.provisioning?.state === 'PENDING_ACTIVATION', det.body?.data?.provisioning?.state);
  check('readiness requiredComplete false', det.body?.data?.provisioning?.readiness?.requiredComplete === false);
  check('principal credentialState present', !!det.body?.data?.access?.principal?.credentialState, det.body?.data?.access?.principal);

  section('P1.F Edit (PATCH)');
  const edit = await api(`/api/platform/schools/${schoolId}`, {
    method: 'PATCH',
    body: JSON.stringify({ city: 'QA Metro', board: 'ICSE', phone: '9000000000' }),
  }, H);
  check('PATCH 200', edit.status === 200, { status: edit.status, body: edit.body });
  check('updatedFields reports all 3', Array.isArray(edit.body?.data?.updatedFields) && ['city','board','phone'].every(f => edit.body.data.updatedFields.includes(f)), edit.body?.data?.updatedFields);
  const det2 = await api(`/api/platform/schools/${schoolId}`, {}, H);
  check('city persisted', det2.body?.data?.school?.city === 'QA Metro', det2.body?.data?.school?.city);
  check('board persisted', det2.body?.data?.school?.board === 'ICSE', det2.body?.data?.school?.board);

  section('P1.G Activate');
  const act = await api(`/api/platform/schools/${schoolId}/activate`, { method: 'POST' }, H);
  check('activate 200', act.status === 200, { status: act.status, body: act.body });
  check('status ACTIVE', act.body?.data?.status === 'ACTIVE');
  const actAgain = await api(`/api/platform/schools/${schoolId}/activate`, { method: 'POST' }, H);
  check('re-activate 409', actAgain.status === 409, actAgain.status);

  section('P1.H Feature flags');
  const ff = await api(`/api/platform/schools/${schoolId}/feature-flags`, {
    method: 'PATCH', body: JSON.stringify({ fees: false, transport: true }),
  }, H);
  check('feature-flags 200', ff.status === 200, { status: ff.status, body: ff.body });
  const ffCheck = await api(`/api/platform/schools/${schoolId}`, {}, H);
  const flags = ffCheck.body?.data?.school?.featureFlags;
  check('fees=false persisted', flags?.fees === false, flags);

  section('P1.I Plan change + subscription payment');
  const plan = await api(`/api/platform/schools/${schoolId}/plan`, {
    method: 'PATCH', body: JSON.stringify({ plan: 'PRO', reason: 'QA e2e upgrade' }),
  }, H);
  check('plan PATCH 200', plan.status === 200, { status: plan.status, body: plan.body });

  const pay = await api(`/api/platform/schools/${schoolId}/subscription/payments`, {
    method: 'POST',
    body: JSON.stringify({ amount: 12000, currency: 'INR', mode: 'BANK_TRANSFER', paymentDate: '2026-10-18', periodMonths: 12, reference: `QA-${RUN}`, notes: 'QA e2e payment' }),
  }, H);
  check('payment 200', pay.status === 200, { status: pay.status, body: pay.body });

  const sub = await api(`/api/platform/schools/${schoolId}/subscription`, {}, H);
  check('subscription GET 200', sub.status === 200, sub.status);
  check('entitlement present', !!sub.body?.data?.entitlement || !!sub.body?.data?.subscription, sub.body?.data && Object.keys(sub.body.data));

  section('P1.J Suspend / reactivate');
  const susp = await api(`/api/platform/schools/${schoolId}/suspend`, {
    method: 'POST', body: JSON.stringify({ reason: 'QA e2e suspension drill' }),
  }, H);
  check('suspend 200', susp.status === 200, { status: susp.status, body: susp.body });
  check('status SUSPENDED', susp.body?.data?.status === 'SUSPENDED');
  const reAct = await api(`/api/platform/schools/${schoolId}/reactivate`, { method: 'POST' }, H);
  check('reactivate 200', reAct.status === 200, { status: reAct.status, body: reAct.body });
  check('back to ACTIVE', reAct.body?.data?.status === 'ACTIVE');

  section('P1.K Audit trail for school lifecycle');
  const audit = await api(`/api/platform/audit?schoolId=${schoolId}&page=1`, {}, H);
  check('audit 200', audit.status === 200, audit.status);
  const actions: string[] = (audit.body?.data?.events ?? []).map((e: any) => e.action);
  const expectAudit = ['platform.school.provisioned','platform.school.updated','platform.school.activated','platform.school.suspended','platform.school.reactivated'];
  for (const a of expectAudit) check(`audit has ${a}`, actions.includes(a), actions.slice(0, 12));

  section('P1.L Delete flow (second throwaway school)');
  const prov3 = await api('/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA Throwaway Institute ${RUN}`, slug: `qa-toss-${RUN}`, code: `QT-${RUN.toUpperCase()}`,
      board: 'CBSE', plan: 'FREE', billingModel: 'SCHOOL_WIDE',
      principalName: 'QA Throwaway', principalEmail: `qa.toss.${RUN}@qafix.scholario.dev`, authMethod: 'PASSWORD',
    }),
  }, H);
  check('throwaway provisioned', prov3.status === 200 || prov3.status === 201, { status: prov3.status });
  const tossId = prov3.body?.data?.school?.id;
  const delWrong = await api(`/api/platform/schools/${tossId}?confirmName=WRONG%20NAME`, { method: 'DELETE' }, H);
  check('delete with wrong confirmName rejected', delWrong.status >= 400 && delWrong.status < 500, delWrong.status);
  const del = await api(`/api/platform/schools/${tossId}?confirmName=${encodeURIComponent(`QA Throwaway Institute ${RUN}`)}`, { method: 'DELETE' }, H);
  check('delete 200', del.status === 200, { status: del.status, body: del.body });
  const del404 = await api(`/api/platform/schools/${tossId}`, {}, H);
  check('deleted school 404', del404.status === 404, del404.status);
  const delAudit = await api(`/api/platform/audit?action=platform.school.deleted&page=1`, {}, H);
  check('audit has platform.school.deleted', (delAudit.body?.data?.events ?? []).some((e: any) => e.targetId === tossId));

  section('P1.M Listing filters on the QA school');
  const byQ = await api(`/api/platform/schools?q=${encodeURIComponent('QA E2E Validation')}`, {}, H);
  check('search finds QA school', (byQ.body?.data?.schools ?? []).some((s: any) => s.id === schoolId), byQ.body?.data?.total);
  const byStatus = await api(`/api/platform/schools?status=ACTIVE`, {}, H);
  check('status filter includes QA school', (byStatus.body?.data?.schools ?? []).some((s: any) => s.id === schoolId));
  const byPlan = await api(`/api/platform/schools?plan=PRO`, {}, H);
  check('plan filter includes QA school', (byPlan.body?.data?.schools ?? []).some((s: any) => s.id === schoolId));

  section('P1.N Negative auth checks');
  const noAuth = await api('/api/platform/schools');
  check('no token 401', noAuth.status === 401, noAuth.status);
  const badToken = await api('/api/platform/schools', {}, 'deadbeef');
  check('bad token 401', badToken.status === 401, badToken.status);

  summary('P1 school lifecycle');
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
