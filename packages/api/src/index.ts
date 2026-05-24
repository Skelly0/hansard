import './env.js';
import './types.js';
import { buildApp } from './app.js';

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '0.0.0.0';
const BOT_NAME = process.env.BOT_DISPLAY_NAME || 'Hansard';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`${BOT_NAME} API running on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
