// 检查图片生成模型配置
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

// 尝试多个可能的数据库路径
const paths = [
  join(homedir(), '.pyapp', 'data', 'app.db'),
  'E:\\PY\\Documents\\CODES\\PY_APP\\app\\data\\pyapp\\data\\app.db',
  '.pyapp/data/app.db',
];

let dbPath = '';
for (const p of paths) {
  if (existsSync(p)) { dbPath = p; break; }
}
console.log('DB path:', dbPath);

if (!dbPath) {
  console.error('DB not found!');
  process.exit(1);
}

const db = new Database(dbPath);

console.log('\n=== app_model_config (所有行) ===');
const configs = db.query(`SELECT * FROM app_model_config`).all();
console.log(JSON.stringify(configs, null, 2));

console.log('\n=== ai_providers (所有) ===');
const providers = db.query(`SELECT id, name, provider_type, base_url, api_key LIKE ? as has_key FROM ai_providers`).all('%sk%');
console.log(JSON.stringify(providers, null, 2));

console.log('\n=== model_registry (带 image 能力) ===');
const imageModels = db.query(`SELECT id, model_id, name, provider_id, capabilities FROM model_registry WHERE capabilities LIKE '%image%' OR capabilities LIKE '%generation%' LIMIT 20`).all();
console.log(JSON.stringify(imageModels, null, 2));

db.close();
