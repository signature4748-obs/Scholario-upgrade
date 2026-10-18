import { api, platformLogin, check, summary, section, RUN } from './plib';

const ROOT_EMAIL = 'admin@scholario.cloud';
const envTxt = (await import('fs')).readFileSync('/home/z/my-project/.env', 'utf8');
const ROOT_PW = envTxt.match(/^SEED_PLATFORM_ROOT_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')!;
const OPS_PW = envTxt.match(/^SEED_PLATFORM_OPS_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')! || 'ops12345';

async function main() {
  section('P2.A Root session + roster');
  const root = await platformLogin(ROOT_EMAIL, ROOT_PW);
  check('root login', root.status === 200 && !!root.token, root.status);
  const H = root.token!;
  const roster = await api('/api/platform/admins', {}, H);
  check('GET admins 200', roster.status === 200, roster.status);
  check('permissionCatalog present', Array.isArray(roster.body?.data?.permissionCatalog) && roster.body.data.permissionCatalog.length === 10, roster.body?.data?.permissionCatalog?.length);
  check('root in roster', (roster.body?.data?.admins ?? []).some((a: any) => a.isRoot === true));

  section('P2.B Create limited QA platform admin');
  const qaAdminEmail = `qa.limited.${RUN}@qafix.scholario.dev`;
  const create = await api('/api/platform/admins', {
    method: 'POST',
    body: JSON.stringify({
      name: 'QA Limited Admin',
      email: qaAdminEmail,
      password: 'QaLimited!2026',
      isRoot: false,
      permissions: ['schools.read', 'audit.read'],
    }),
  }, H);
  check('POST admins 200/201', create.status === 200 || create.status === 201, { status: create.status, body: create.body });
  const qaAdminId = create.body?.data?.id;
  check('admin id returned', !!qaAdminId);
  const grants = create.body?.data?.grants ?? [];
  check('2 grants seeded', grants.length === 2 && grants.every((g: any) => ['schools.read', 'audit.read'].includes(g.key ?? g)), grants);

  section('P2.C Permission grant/revoke');
  const grant = await api(`/api/platform/admins/${qaAdminId}/permissions`, {
    method: 'PATCH', body: JSON.stringify({ key: 'announcements.manage', granted: true }),
  }, H);
  check('grant 200', grant.status === 200, { status: grant.status, body: grant.body });
  const revoke = await api(`/api/platform/admins/${qaAdminId}/permissions`, {
    method: 'PATCH', body: JSON.stringify({ key: 'announcements.manage', granted: false }),
  }, H);
  check('revoke 200', revoke.status === 200, { status: revoke.status, body: revoke.body });
  const unknownKey = await api(`/api/platform/admins/${qaAdminId}/permissions`, {
    method: 'PATCH', body: JSON.stringify({ key: 'not.a.key', granted: true }),
  }, H);
  check('unknown permission key rejected', unknownKey.status >= 400 && unknownKey.status < 500, unknownKey.status);

  section('P2.D Enforcement as the limited admin');
  const qa = await platformLogin(qaAdminEmail, 'QaLimited!2026');
  check('limited login 200', qa.status === 200, { status: qa.status, err: qa.body?.error });
  check('permissions = 2', JSON.stringify((qa.body?.data?.permissions ?? []).slice().sort()) === JSON.stringify(['audit.read', 'schools.read']), qa.body?.data?.permissions);
  const qaH = qa.token!;
  check('schools list allowed', (await api('/api/platform/schools?page=1', {}, qaH)).status === 200);
  check('audit allowed', (await api('/api/platform/audit?page=1', {}, qaH)).status === 200);
  check('admins list 403', (await api('/api/platform/admins', {}, qaH)).status === 403);
  check('settings PATCH 403', (await api('/api/platform/settings', { method: 'PATCH', body: JSON.stringify({ showDemoSchool: true }) }, qaH)).status === 403);
  check('provision 403', (await api('/api/platform/schools', { method: 'POST', body: JSON.stringify({ name: 'x', slug: 'x-qadup', code: 'XQADUP', board: 'CBSE', principalName: 'x', principalEmail: `x.${RUN}@qafix.scholario.dev` }) }, qaH)).status === 403);

  section('P2.E Self-modification + root-minting refusals');
  const selfGrant = await api(`/api/platform/admins/${qa.body?.data?.admin?.id}/permissions`, {
    method: 'PATCH', body: JSON.stringify({ key: 'admins.manage', granted: true }),
  }, qaH);
  check('self-grant refused', selfGrant.status >= 400 && selfGrant.status < 500, selfGrant.status);
  const mintRoot = await api('/api/platform/admins', {
    method: 'POST', body: JSON.stringify({ name: 'QA Minted Root', email: `qa.mint.${RUN}@qafix.scholario.dev`, password: 'MintRoot!2026', isRoot: true }),
  }, qaH);
  check('non-root root-minting refused', mintRoot.status >= 400 && mintRoot.status < 500, mintRoot.status);

  section('P2.F Ops admin remains limited');
  const ops = await platformLogin('ops@scholario.io', OPS_PW);
  check('ops login', ops.status === 200, ops.status);
  const opsH = ops.token!;
  check('ops admins GET 403', (await api('/api/platform/admins', {}, opsH)).status === 403);
  const opsCreate = await api('/api/platform/admins', { method: 'POST', body: JSON.stringify({ name: 'x', email: `y.${RUN}@qafix.scholario.dev`, password: 'whatever123' }) }, opsH);
  check('ops admin-create 403', opsCreate.status === 403, opsCreate.status);

  section('P2.G Suspend / reactivate the limited admin');
  const susp = await api(`/api/platform/admins/${qaAdminId}/suspend`, { method: 'POST' }, H);
  check('suspend 200', susp.status === 200, { status: susp.status, body: susp.body });
  check('suspended token rejected', (await api('/api/platform/schools?page=1', {}, qaH)).status === 401);
  const suspLogin = await platformLogin(qaAdminEmail, 'QaLimited!2026');
  check('suspended login refused', suspLogin.status === 401 || suspLogin.status === 403, suspLogin.status);
  const react = await api(`/api/platform/admins/${qaAdminId}/reactivate`, { method: 'POST' }, H);
  check('reactivate 200', react.status === 200, { status: react.status, body: react.body });
  const reLogin = await platformLogin(qaAdminEmail, 'QaLimited!2026');
  check('login works after reactivation', reLogin.status === 200, reLogin.status);

  section('P2.H Audit trail for admin lifecycle');
  const audit = await api('/api/platform/audit?action=platform.admin.created&page=1', {}, H);
  check('audit admin.created', (audit.body?.data?.events ?? []).some((e: any) => e.targetId === qaAdminId));
  const auditPerm = await api('/api/platform/audit?action=platform.admin.permission_changed&page=1', {}, H);
  check('audit permission_changed', (auditPerm.body?.data?.events ?? []).some((e: any) => e.targetId === qaAdminId), (auditPerm.body?.data?.events ?? []).slice(0, 3));
  const auditSusp = await api('/api/platform/audit?adminId=&page=1', {}, H);
  const suspActs = (auditSusp.body?.data?.events ?? []).map((e: any) => e.action);
  check('audit admin.suspended', suspActs.includes('platform.admin.suspended'));

  section('P2.I Root protection');
  const rootRow = (roster.body?.data?.admins ?? []).find((a: any) => a.isRoot);
  if (rootRow) {
    const rootPermEdit = await api(`/api/platform/admins/${rootRow.id}/permissions`, {
      method: 'PATCH', body: JSON.stringify({ key: 'schools.read', granted: false }),
    }, H);
    check('revoking root permission refused', rootPermEdit.status >= 400 && rootPermEdit.status < 500, rootPermEdit.status);
  }

  summary('P1 admin permissions lifecycle');
}
main().catch(e => { console.error(e); process.exit(1); });
