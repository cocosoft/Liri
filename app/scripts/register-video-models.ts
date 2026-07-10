/**
 * 注册更多 SiliconFlow 视频模型并测试
 */
import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DB_PATH = join(homedir(), '.pyapp', 'data', 'app.db');
const CONFIG_PATH = join(homedir(), '.pyapp', 'config.json');

const db = new Database(DB_PATH);
const now = Math.floor(Date.now() / 1000);

// 获取 SiliconFlow 供应商
const silicon = db
  .query("SELECT id FROM ai_providers WHERE provider_type = 'siliconflow' AND is_active = 1")
  .get() as any;

if (!silicon) {
  console.log('未找到 SiliconFlow 供应商');
  process.exit(1);
}

const candidateModels = [
  { modelId: 'tencent/HunyuanVideo', displayName: 'HunyuanVideo (SiliconFlow)' },
  { modelId: 'genmo/mochi-1-preview', displayName: 'Mochi-1 (SiliconFlow)' },
];

// 注册缺失的模型
for (const m of candidateModels) {
  const existing = db
    .query("SELECT id FROM model_registry WHERE model_id = ?")
    .get(m.modelId) as any;

  if (!existing) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO model_registry (id, model_id, display_name, context_window, max_output_tokens,
        capabilities, provider_mappings, input_price, output_price, cache_read_price, cache_write_price,
        provider_id, enabled, is_custom, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, m.modelId, m.displayName,
      200000, 4096,
      JSON.stringify(['video_generation']), '{}',
      0.5, 0, 0, 0,
      silicon.id, 1, 1, now, now
    );
    console.log(`✅ 已注册: ${m.modelId} (${id})`);
  } else {
    console.log(`⏭️ 已存在: ${m.modelId}`);
  }
}

// 更新任务分工为 tencent/HunyuanVideo
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
if (!config.models) config.models = {};
if (!config.models.tasks) config.models.tasks = {};
config.models.tasks.video = 'tencent/HunyuanVideo';
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
console.log(`✅ 任务分工 video → tencent/HunyuanVideo`);

// 验证
console.log('\n当前视频模型:');
const videoModels = db
  .query("SELECT model_id, display_name, enabled FROM model_registry WHERE capabilities LIKE '%video_generation%'")
  .all() as any[];
videoModels.forEach((m: any) => {
  console.log(`  ${m.model_id} (${m.display_name}) enabled=${!!m.enabled}`);
});

db.close();