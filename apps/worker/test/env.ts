// Runs in every test worker before modules load. Dedicated DB + Redis db index keep tests off dev data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://goshort:goshort@localhost:5432/goshort_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.APP_URL = 'http://localhost:5173';
process.env.DEFAULT_SHORT_DOMAIN = 'localhost:4001';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'http://localhost:5173';
