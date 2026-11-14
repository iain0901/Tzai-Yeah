import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setup } from './setup.mjs';
import { closeDatabase } from '../../lib/server/sqlite-runtime.mjs';

try {
  const dev = process.argv.includes('--dev');
  const entry = dev ? 'node_modules/next/dist/bin/next' : existsSync('server.js') ? 'server.js' : '.next/standalone/server.js';
  if (!existsSync(entry)) throw new Error('尚未建置網站，請先執行 npm ci 與 npm run build。');
  await setup();
  closeDatabase();
  const env = { ...process.env, NODE_ENV: dev ? 'development' : 'production', HOSTNAME: process.env.HOSTNAME || '127.0.0.1', PORT: process.env.PORT || '3000' };
  const args = [path.resolve(entry), ...(dev ? ['dev', '--hostname', env.HOSTNAME, '--port', env.PORT] : [])];
  const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 0; });
} catch (error) { closeDatabase(); console.error(error.message); process.exitCode = 1; }
