import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const dbPath = join(homedir(), '.pyapp', 'data', 'app.db');
const db = new Database(dbPath);

// Check last log entries in the log file
const fs = require('fs');
const logPath = join(homedir(), '.pyapp', 'data', 'logs', 'app.log');
const stat = fs.statSync(logPath);
console.log('Log file size:', stat.size, 'bytes');
console.log('Log file last modified:', stat.mtime.toISOString());

// Check if there are any entries after "鉴权成功"
const content = fs.readFileSync(logPath, 'utf-8');
const lines = content.split('\n').filter((l: string) => l.trim());
console.log('Total log lines:', lines.length);
console.log('Last 3 lines:');
for (const line of lines.slice(-3)) {
  try {
    const obj = JSON.parse(line);
    console.log(`  ${obj.timestamp} [${obj.level}] ${obj.module}: ${obj.message}`);
  } catch {
    console.log('  ' + line.slice(0, 150));
  }
}

db.close();