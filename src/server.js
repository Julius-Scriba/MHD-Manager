// mhd-manager · Einstiegspunkt
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = Number(process.env.PORT || 8091);
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));

const { app } = createApp({
  dbFile: join(dataDir, 'mhd.db'),
  dataDir,
  publicDir: join(root, 'public'),
});

const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`[mhd] läuft auf http://127.0.0.1:${port} · Daten: ${dataDir}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[mhd] ${sig} — beende.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
