import { Database } from 'bun:sqlite';

const userDb = new Database('C:/Users/Administrator/.pyapp/data/app.db');
const tables = userDb.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== User Home DB Tables ===');
console.log(JSON.stringify(tables, null, 2));

// Check if channel_configs exists
try {
  const cc = userDb.query('SELECT * FROM channel_configs').all();
  console.log('\n=== channel_configs rows ===');
  console.log(JSON.stringify(cc, null, 2));
} catch (e: any) {
  console.log('\nchannel_configs table:', e.message);
}

userDb.close();