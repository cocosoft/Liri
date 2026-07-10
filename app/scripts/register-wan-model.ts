import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const dbPath = join(homedir(), '.pyapp', 'data', 'app.db');
const db = new Database(dbPath);

// 1. 注册 Wan-AI/Wan2.2-I2V-A14B 到生产 DB
const existing = db
  .prepare("SELECT id FROM model_registry WHERE model_id = 'Wan-AI/Wan2.2-I2V-A14B'")
  .get() as any;

if (existing) {
  console.log('Wan-AI 已存在:', existing.id);
} else {
  // 找到 SiliconFlow provider
  const siliconProvider = db
    .prepare("SELECT id FROM ai_providers WHERE provider_type = 'siliconflow'")
    .get() as any;

  if (!siliconProvider) {
    console.log('❌ 未找到 SiliconFlow 供应商');
    db.close();
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const newId = randomUUID();
  db.prepare(`
    INSERT INTO model_registry (id, model_id, display_name, context_window, max_output_tokens,
      capabilities, provider_mappings, input_price, output_price, cache_read_price, cache_write_price,
      provider_id, enabled, is_custom, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId,
    'Wan-AI/Wan2.2-I2V-A14B',
    'Wan 2.2 I2V (SiliconFlow)',
    200000,
    4096,
    JSON.stringify(['video_generation', 'image_generation']),
    '{}',
    0.03,  // input_price per 1M
    0,     // output_price
    0,
    0,
    siliconProvider.id,
    1,     // enabled
    1,     // is_custom
    now,
    now
  );
  console.log('✅ Wan-AI 已注册:', newId, '→ provider:', siliconProvider.id);
}

// 2. 验证
console.log('\n=== 验证 ===');
const videoModels = db
  .query("SELECT model_id, id, capabilities, enabled, provider_id FROM model_registry WHERE capabilities LIKE '%video%'")
  .all();
console.log(JSON.stringify(videoModels, null, 2));

db.close();
console.log('\n完成！');