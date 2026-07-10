import { Database } from 'bun:sqlite';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const DB_PATH = 'e:/PY/CODES/PY_APP/app/data/pyapp/data/app.db';
const CONFIG_PATH = 'e:/PY/CODES/PY_APP/app/data/pyapp/config.json';
const BACKUP_DIR = 'e:/PY/CODES/PY_APP/app/data/pyapp/data/backups/app';

console.log('=== 配置开发环境 ===');

// 0. 备份
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/:/g, '-');
copyFileSync(DB_PATH, join(BACKUP_DIR, `app-dev-${ts}.db`));
console.log(`已备份 DB 到: ${join(BACKUP_DIR, `app-dev-${ts}.db`)}`);

const db = new Database(DB_PATH);

// 1. 修复 Wan-AI capabilities
console.log('\n1. 修复 Wan-AI capabilities...');
const wanModel = db
  .prepare("SELECT id, model_id, capabilities FROM model_registry WHERE model_id = 'Wan-AI/Wan2.2-I2V-A14B'")
  .get() as any;

if (wanModel) {
  const newCaps = JSON.stringify(['video_generation', 'image_generation']);
  db.prepare('UPDATE model_registry SET capabilities = ? WHERE id = ?').run(newCaps, wanModel.id);
  console.log(`  ✅ Wan-AI capabilities → ${newCaps}`);
} else {
  console.log('  ❌ Wan-AI 不存在');
}

// 2. 检查 SiliconFlow provider 类型
console.log('\n2. 检查 SiliconFlow provider...');
const siliconProvider = db
  .prepare("SELECT id, name, provider_type FROM ai_providers WHERE id = '080b701f-6271-4dab-a95c-e6e1c3650ac8'")
  .get() as any;

if (siliconProvider) {
  console.log(`  当前: ${siliconProvider.name} (${siliconProvider.provider_type})`);
  if (siliconProvider.provider_type !== 'siliconflow') {
    db.prepare('UPDATE ai_providers SET provider_type = ? WHERE id = ?').run('siliconflow', siliconProvider.id);
    console.log(`  ✅ 已修正 provider_type → siliconflow`);
  }
}

// 3. 注册 FAL provider (如果不存在)
console.log('\n3. 注册 FAL provider...');
const falProvider = db
  .prepare("SELECT id FROM ai_providers WHERE provider_type = 'fal'")
  .get() as any;

if (falProvider) {
  console.log(`  ✅ FAL 已存在: ${falProvider.id}`);
} else {
  const falId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO ai_providers (id, name, provider_type, api_key, base_url, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(falId, 'FAL.ai', 'fal', '', 'https://fal.run', 1, now, now);
  console.log(`  ✅ FAL 已注册: ${falId}`);
}

// 4. 注册 Kling 模型 (如果不存在)
console.log('\n4. 注册 Kling 模型...');
const klingModel = db
  .prepare("SELECT id FROM model_registry WHERE model_id = 'fal-ai/kling-video/v2.1'")
  .get() as any;

if (klingModel) {
  console.log(`  ✅ Kling 已存在: ${klingModel.id}`);
} else {
  const falProv = db
    .prepare("SELECT id FROM ai_providers WHERE provider_type = 'fal'")
    .get() as any;
  const klingId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO model_registry (id, model_id, display_name, context_window, max_output_tokens,
      capabilities, provider_mappings, input_price, output_price, cache_read_price, cache_write_price,
      provider_id, enabled, is_custom, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    klingId, 'fal-ai/kling-video/v2.1', 'Kling 2.1 (FAL)',
    200000, 4096,
    JSON.stringify(['video_generation']), '{}',
    0.5, 0, 0, 0,
    falProv.id, 1, 1, now, now
  );
  console.log(`  ✅ Kling 已注册: ${klingId}`);
}

// 5. 更新 config.json 任务分工
console.log('\n5. 更新任务分工...');
if (existsSync(CONFIG_PATH)) {
  copyFileSync(CONFIG_PATH, join(BACKUP_DIR, `config-dev-${ts}.json`));
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.models) config.models = {};
  if (!config.models.tasks) config.models.tasks = {};
  config.models.tasks.video = 'Wan-AI/Wan2.2-I2V-A14B';
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`  ✅ 任务分工 video → Wan-AI/Wan2.2-I2V-A14B`);
} else {
  console.log(`  ⚠️ config.json 不存在: ${CONFIG_PATH}`);
}

// 6. 验证
console.log('\n=== 验证 ===');
console.log('\n视频模型:');
const videoModels = db
  .query("SELECT model_id, id, capabilities, enabled, provider_id FROM model_registry WHERE capabilities LIKE '%video%'")
  .all() as any[];
videoModels.forEach((m: any) => {
  console.log(`  ${m.model_id} (${m.id})`);
  console.log(`    capabilities: ${m.capabilities}`);
  console.log(`    provider_id: ${m.provider_id}`);
});

console.log('\n供应商:');
const providers = db
  .query('SELECT id, name, provider_type FROM ai_providers')
  .all() as any[];
providers.forEach((p: any) => {
  console.log(`  ${p.name} (${p.provider_type}) - ${p.id}`);
});

db.close();
console.log('\n完成！');