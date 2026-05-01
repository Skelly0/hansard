import { defineConfig } from 'drizzle-kit';

process.loadEnvFile('../../.env');

export default defineConfig({
  schema: './src/schema/*',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
