/**
 * 查询 channel_configs 表
 */
import { Database } from './src/core/external/sqlite3.js';
import { resolveDbPath } from './src/modules/core/paths.js';

const dbPath = resolveDbPath();
console.log('DB Path:', dbPath);

const db = new Database(dbPath);
db.all('SELECT * FROM channel_configs', (err: Error | null, rows: unknown[]) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('channel_configs rows:', JSON.stringify(rows, null, 2));
  }
  db.close();
});