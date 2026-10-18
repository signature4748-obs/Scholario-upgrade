const res = await fetch('http://localhost:3000/api/platform/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.245.7.7' },
  body: JSON.stringify({ email: 'admin@scholario.cloud', password: process.env.SEED_PLATFORM_ROOT_PASSWORD }),
});
console.log(res.status, JSON.stringify(await res.json()).slice(0, 200));
