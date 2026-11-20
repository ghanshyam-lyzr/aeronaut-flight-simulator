import { createPool, migrate } from './database.js';
import { createApp } from './http.js';

const pool = createPool();
try { await migrate(pool); }
catch (error) { await pool.end(); throw error; }
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const server = createApp({ pool });
server.listen(port, '0.0.0.0', () => console.log(`Aeronaut listening on 0.0.0.0:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 25000).unref();
});
