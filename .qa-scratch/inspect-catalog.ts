import { api, platformLogin } from './plib';
const envTxt = (await import('fs')).readFileSync('/home/z/my-project/.env', 'utf8');
const ROOT_PW = envTxt.match(/^SEED_PLATFORM_ROOT_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')!;
const { token } = await platformLogin('admin@scholario.cloud', ROOT_PW);
const r = await api('/api/platform/admins', {}, token!);
console.log(JSON.stringify(r.body?.data, (k, v) => k === 'grants' || k === 'admins' ? '[omitted]' : v, 1).slice(0, 1500));
