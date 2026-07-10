import { Database } from 'bun:sqlite';

const db = new Database('e:/PY/CODES/PY_APP/app/data/pyapp/data/app.db', { readonly: true });

console.log('=== ai_app_model_configs（任务分工） ===');
try {
  const configs = db.query('SELECT * FROM ai_app_model_configs').all();
  console.log(JSON.stringify(configs, null, 2));
} catch (e) {
  console.log('表不存在或查询失败:', (e as Error).message);
}

console.log('\n=== 所有表 ===');
try {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log(JSON.stringify(tables, null, 2));
} catch (e) {
  console.log('查询失败:', (e as Error).message);
}

console.log('\n=== Wan-AI 模型详情 ===');
const wanModel = db.query("SELECT * FROM model_registry WHERE model_id LIKE '%Wan%'").all();
console.log(JSON.stringify(wanModel, null, 2));

db.close();