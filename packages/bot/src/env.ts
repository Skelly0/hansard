import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: resolve(__dirname, '../../../.env') });
loadDotenv();
