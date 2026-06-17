import { Database } from 'bun:sqlite';

const db = new Database('data/pyapp/data/app.db');
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', JSON.stringify(tables, null, 2));
db.close();