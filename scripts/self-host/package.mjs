import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const target = '.next/standalone';
if (!existsSync(path.join(target, 'server.js'))) throw new Error('Next.js standalone 產物不存在。');
for (const directory of ['public', '.next/static', 'drizzle', 'scripts/self-host', 'lib/server']) {
  const output = path.join(target, directory);
  mkdirSync(path.dirname(output), { recursive: true });
  cpSync(directory, output, { recursive: true });
}
console.log('Standalone 已包含圖像、音樂、程式、資料庫遷移與初始化工具。');
