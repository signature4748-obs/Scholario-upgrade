console.log('has SEED_PLATFORM_ROOT_PASSWORD:', !!process.env.SEED_PLATFORM_ROOT_PASSWORD);
console.log('has DATABASE_URL:', (process.env.DATABASE_URL ?? '').slice(0, 30));
