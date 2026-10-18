import { schoolLogin } from './plib';
const r = await schoolLogin('qa.principal.qad45c10@qafix.scholario.dev', 'QaFix!2026x');
console.log(JSON.stringify({ status: r.status, data: r.body?.data }, null, 1).slice(0, 800));
