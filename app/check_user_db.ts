import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const userDb = new Database(join(homedir(), '.pyapp', 'data', 'app.db'));
const tables = userDb.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== User Home DB Tables ===');
console.log(JSON.stringify(tables, null, 2));

// Check if channel_configs exists
try {
  const cc = userDb.query('SELECT * FROM channel_configs').all();
  console.log('\n=== channel_configs rows ===');
  console.log(JSON.stringify(cc, null, 2));
} catch (e) {
  console.log('\nchannel_configs table:', e instanceof Error ? e.message : String(e));
}

userDb.close();