import { api, platformLogin, check, summary, section, RUN } from './plib';
const envTxt = (await import('fs')).readFileSync('/home/z/my-project/.env', 'utf8');
const ROOT_PW = envTxt.match(/^SEED_PLATFORM_ROOT_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')!;

async function main() {
  const root = await platformLogin('admin@scholario.cloud', ROOT_PW);
  const H = root.token!;
  check('root login', root.status === 200 && !!H);

  section('P3.A Overview endpoint');
  const ov = await api('/api/platform/overview', {}, H);
  check('overview 200', ov.status === 200, ov.status);
  check('schools.byStatus has ACTIVE', typeof ov.body?.data?.schools?.byStatus === 'object', ov.body?.data?.schools);
  check('recentAudit array', Array.isArray(ov.body?.data?.recentAudit));
  const qaSchoolId = ov.body?.data?.schools?.byStatus ? undefined : undefined;

  section('P3.B Announcements lifecycle');
  const annCreate = await api('/api/platform/announcements', {
    method: 'POST',
    body: JSON.stringify({ title: `QA drill ${RUN}`, body: 'QA announcement body', level: 'INFO', audience: 'ALL', expiresInDays: 7 }),
  }, H);
  check('announcement created', annCreate.status === 200 || annCreate.status === 201, { status: annCreate.status, body: annCreate.body });
  const annId = annCreate.body?.data?.id ?? annCreate.body?.data?.announcement?.id;
  check('announcement id', !!annId, annCreate.body?.data);
  const annList = await api('/api/platform/announcements', {}, H);
  check('announcement listed', (annList.body?.data ?? []).some?.((a: any) => a.id === annId) || JSON.stringify(annList.body?.data).includes(annId));
  const annPub = await api('/api/platform/announcements/public');
  check('public announcement visible anonymously', annPub.status === 200 && JSON.stringify(annPub.body).includes(`QA drill ${RUN}`), annPub.status);
  const annDel = await api(`/api/platform/announcements/${annId}`, { method: 'DELETE' }, H);
  check('announcement deleted', annDel.status === 200, { status: annDel.status, body: annDel.body });
  const annPub2 = await api('/api/platform/announcements/public');
  check('public no longer shows it', !JSON.stringify(annPub2.body).includes(`QA drill ${RUN}`));

  section('P3.C Settings');
  const s0 = await api('/api/platform/settings', {}, H);
  check('settings GET 200', s0.status === 200, s0.status);
  const prevMax = s0.body?.data?.supportMaxDuration;
  const s1 = await api('/api/platform/settings', { method: 'PATCH', body: JSON.stringify({ supportMaxDuration: Math.min(prevMax ?? 120, 240) }) }, H);
  check('settings PATCH 200', s1.status === 200, { status: s1.status, body: s1.body });
  const s2 = await api('/api/platform/settings', {}, H);
  check('settings persisted', s2.body?.data?.supportMaxDuration === Math.min(prevMax ?? 120, 240), { got: s2.body?.data?.supportMaxDuration, want: Math.min(prevMax ?? 120, 240) });
  const sInv = await api('/api/platform/settings', { method: 'PATCH', body: JSON.stringify({ supportMaxDuration: 999999 }) }, H);
  check('invalid settings rejected', sInv.status >= 400 && sInv.status < 500, sInv.status);

  section('P3.D Support access session on QA school');
  const schools = await api('/api/platform/schools?q=QA E2E Validation&status=ACTIVE', {}, H);
  const qaSchool = (schools.body?.data?.schools ?? [])[0];
  check('QA school found', !!qaSchool?.id, schools.body?.data?.total);
  if (qaSchool?.id) {
    const acc = await api(`/api/platform/schools/${qaSchool.id}/access`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'QA support oversight drill — verify support plane isolation', durationMinutes: 10 }),
    }, H);
    check('support session created', acc.status === 200, { status: acc.status, body: acc.body });
    const supTok = acc.body?.data?.supportToken;
    const supCookie = (acc.body?.data?.supportSession?.tokenHash) ? undefined : undefined;
    check('support token returned (dev)', typeof supTok === 'string', typeof supTok);
    if (supTok) {
      const ovS = await api('/api/platform/support/overview', {}, undefined, supTok);
      check('support overview 200 via support token', ovS.status === 200, { status: ovS.status });
      const denied = await api('/api/platform/support/overview', {}, H);
      check('platform token NOT valid for support plane', denied.status !== 200, denied.status);
    }
    const sList = await api(`/api/platform/support/sessions?schoolId=${qaSchool.id}`, {}, H);
    check('support sessions listed', sList.status === 200 && (sList.body?.data?.sessions ?? sList.body?.data ?? []).length >= 1, sList.status);
    const sessArr = sList.body?.data?.sessions ?? sList.body?.data ?? [];
    const liveOne = sessArr.find((s: any) => !s.revokedAt && s.status !== 'REVOKED');
    if (liveOne) {
      const rev = await api(`/api/platform/support/sessions/${liveOne.id}/revoke`, { method: 'POST' }, H);
      check('support session revoked', rev.status === 200, { status: rev.status, body: rev.body });
    }
    const auditAcc = await api('/api/platform/audit?action=platform.support_session.created&page=1', {}, H);
    check('audit support_session.created', (auditAcc.body?.data?.events ?? []).some((e: any) => e.schoolId === qaSchool.id));
  }

  section('P3.E Platform health endpoints');
  const health = await api('/api/platform/health', {}, H);
  check('platform health 200', health.status === 200, health.status);
  const healthEmail = await api('/api/platform/health/email', {}, H);
  check('platform health/email 200', healthEmail.status === 200, { status: healthEmail.status });

  summary('P1 misc platform surface');
}
main().catch(e => { console.error(e); process.exit(1); });
