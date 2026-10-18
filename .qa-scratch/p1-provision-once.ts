import { api, platformLogin, RUN } from './plib';
const envTxt = (await import('fs')).readFileSync('/home/z/my-project/.env', 'utf8');
const ROOT_PW = envTxt.match(/^SEED_PLATFORM_ROOT_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')!;
const t0 = Date.now();
const { token } = await platformLogin('admin@scholario.cloud', ROOT_PW);
console.log('login ms:', Date.now() - t0);
const SLUG = `qa-e2e-${RUN}`;
const t1 = Date.now();
const prov = await api('/api/platform/schools', {
  method: 'POST',
  body: JSON.stringify({
    name: `QA E2E Validation Academy ${RUN}`,
    slug: SLUG,
    code: `QA-${RUN.toUpperCase()}`,
    city: 'QA City', board: 'CBSE', plan: 'STANDARD', billingModel: 'SCHOOL_WIDE',
    principalName: 'QA Principal',
    principalEmail: `qa.principal.${RUN}@qafix.scholario.dev`,
    principalPassword: 'QaFix!2026x',
    authMethod: 'PASSWORD',
    academicYear: '2026-2027',
    classes: [{ name: 'Grade 5', sections: ['A'] }, { name: 'Grade 6', sections: ['A', 'B'] }],
    subjects: ['Mathematics', 'Science'],
  }),
}, token);
console.log('provision ms:', Date.now() - t1, 'status:', prov.status);
console.log(JSON.stringify(prov.body).slice(0, 900));
