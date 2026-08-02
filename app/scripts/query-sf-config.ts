import { homedir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';

const dbPath = join(homedir(), '.pyapp', 'data', 'app.db');
console.log('DB:', dbPath);

if (!existsSync(dbPath)) {
  console.error('DB not found');
  process.exit(1);
}

const db = new Database(dbPath);

// 1. SiliconFlow provider 完整记录
console.log('\n=== SiliconFlow Provider ===');
const sf = db.query(`SELECT * FROM ai_providers WHERE name LIKE ? OR provider_type LIKE ?`).all('%Silicon%', '%silicon%');
console.log(JSON.stringify(sf, null, 2));

// 2. 所有 provider 列表（name + provider_type + is_active）
console.log('\n=== All Providers (简洁) ===');
const all = db.query(`SELECT id, name, provider_type, base_url, is_active FROM ai_providers ORDER BY id`).all();
console.log(JSON.stringify(all, null, 2));

// 3. 所有模型全字段
console.log('\n=== 全部模型 (前50) ===');
const models = db.query(`SELECT * FROM model_registry LIMIT 50`).all();
console.log(JSON.stringify(models, null, 2));

// 4. video 相关模型
console.log('\n=== 视频模型 ===');
const vm = db.query(`SELECT * FROM model_registry WHERE capabilities LIKE '%video%'`).all();
console.log(JSON.stringify(vm, null, 2));

// 5. 模型路由（model_routing 表）
console.log('\n=== model_routing 表 ===');
try {
  const mr = db.query(`SELECT * FROM model_routing LIMIT 20`).all();
  console.log(JSON.stringify(mr, null, 2));
} catch (e) {
  console.log('model_routing error:', e instanceof Error ? e.message : String(e));
}

// 6. video_tasks 表结构
console.log('\n=== video_tasks 表 ===');
try {
  const vt = db.query(`SELECT * FROM video_tasks LIMIT 5`).all();
  console.log(JSON.stringify(vt, null, 2));
} catch (e) {
  console.log('video_tasks error:', e instanceof Error ? e.message : String(e));
}

// 7. channels 中是否有 siliconflow key
console.log('\n=== Channels ===');
try {
  const ch = db.query(`SELECT id, name, channel_type, config FROM channels LIMIT 5`).all();
  console.log(JSON.stringify(ch, null, 2));
} catch (e) {
  console.log('channels error:', e instanceof Error ? e.message : String(e));
}

db.close();
