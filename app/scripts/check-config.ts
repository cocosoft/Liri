import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';

const db = new Database('e:/PY/CODES/PY_APP/app/data/pyapp/data/app.db', { readonly: true });

console.log('=== config.json 中的 models 配置 ===');
try {
  const config = JSON.parse(readFileSync('e:/PY/CODES/PY_APP/app/data/pyapp/data/config.json', 'utf-8'));
  console.log(JSON.stringify(config.models, null, 2));
} catch (e) {
  console.log('读取失败:', (e as Error).message);
}

console.log('\n=== video_tasks 表 ===');
try {
  const tasks = db.query('SELECT * FROM video_tasks').all();
  console.log(JSON.stringify(tasks, null, 2));
} catch (e) {
  console.log('video_tasks 表不存在或查询失败:', (e as Error).message);
}

db.close();