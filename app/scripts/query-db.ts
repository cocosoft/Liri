/**
 * 查询数据库中的视频相关配置 - 排查版
 */
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

const dbPath = join(homedir(), '.pyapp', 'data', 'app.db');
console.log('DB path:', dbPath);

if (!existsSync(dbPath)) {
  console.error('DB not found!');
  process.exit(1);
}

const db = new Database(dbPath);

console.log('\n=== 所有 Provider 信息 ===');
const allProviders = db.query(`SELECT * FROM ai_providers ORDER BY id`).all();
console.log(JSON.stringify(allProviders, null, 2));

console.log('\n=== SiliconFlow Provider 详情 ===');
const sf = db.query(`SELECT * FROM ai_providers WHERE provider_type LIKE ?`).all('%silicon%');
console.log(JSON.stringify(sf, null, 2));

console.log('\n=== model_registry 表结构 ===');
const cols = db.query(`PRAGMA table_info(model_registry)`).all();
console.log(JSON.stringify(cols, null, 2));

console.log('\n=== 所有模型 (前30条, 全字段) ===');
const allModels = db.query(`SELECT * FROM model_registry LIMIT 30`).all();
console.log(JSON.stringify(allModels, null, 2));

console.log('\n=== 标记有 Video 能力的模型 ===');
const videoModels = db.query(`SELECT * FROM model_registry WHERE capabilities LIKE '%video%' LIMIT 20`).all();
console.log(JSON.stringify(videoModels, null, 2));

console.log('\n=== 所有表名 ===');
const tables = db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all();
console.log(JSON.stringify(tables, null, 2));

// 额外：查找与视频模型路由相关的表
for (const t of tables) {
  const name = (t as any).name;
  if (name.includes('model') || name.includes('route') || name.includes('video') || name.includes('tool')) {
    console.log(`\n--- ${name} (前5条) ---`);
    try {
      const rows = db.query(`SELECT * FROM "${name}" LIMIT 5`).all();
      console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
      console.log('error:', e instanceof Error ? e.message : String(e));
    }
  }
}

db.close();
