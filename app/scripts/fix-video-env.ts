/**
 * 修复视频生成环境配置
 *
 * 1. 修复 SiliconFlow base_url（从完整 chat 端点 → base URL）
 * 2. 注册 T2V 模型 Lightricks/LTX-Video（SiliconFlow 视频 API 支持）
 * 3. 更新任务分工为 T2V 模型（先测试文生视频）
 * 4. 验证所有配置
 *
 * 用法: cd app && bun run scripts/fix-video-env.ts
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

console.log('=== 视频生成环境修复 ===\n');

// ================================================================
// 1. 修复 SiliconFlow base_url
// ================================================================
console.log('1. 修复 SiliconFlow base_url...');
const silicon = db
  .query("SELECT id, name, base_url FROM ai_providers WHERE provider_type = 'siliconflow'")
  .get() as any;

if (silicon) {
  const correctBaseUrl = 'https://api.siliconflow.cn/v1';
  if (silicon.base_url !== correctBaseUrl) {
    db.prepare('UPDATE ai_providers SET base_url = ?, updated_at = ? WHERE id = ?')
      .run(correctBaseUrl, now, silicon.id);
    console.log(`   ✅ base_url: "${silicon.base_url}" → "${correctBaseUrl}"`);
  } else {
    console.log(`   ✅ base_url 已正确: "${silicon.base_url}"`);
  }
} else {
  console.log('   ❌ 未找到 SiliconFlow 供应商');
}

// ================================================================
// 2. 注册 T2V 模型 (Lightricks/LTX-Video)
// ================================================================
console.log('\n2. 注册 T2V 模型...');

const t2vModelId = 'Lightricks/LTX-Video';
const existingT2V = db
  .query("SELECT id FROM model_registry WHERE model_id = ?")
  .get(t2vModelId) as any;

if (existingT2V) {
  console.log(`   ✅ ${t2vModelId} 已存在: ${existingT2V.id}`);
} else if (silicon) {
  const t2vId = randomUUID();
  db.prepare(`
    INSERT INTO model_registry (id, model_id, display_name, context_window, max_output_tokens,
      capabilities, provider_mappings, input_price, output_price, cache_read_price, cache_write_price,
      provider_id, enabled, is_custom, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t2vId,
    t2vModelId,
    'LTX-Video (SiliconFlow)',
    200000,
    4096,
    JSON.stringify(['video_generation']),
    '{}',
    0.5,
    0,
    0,
    0,
    silicon.id,
    1,
    1,
    now,
    now
  );
  console.log(`   ✅ ${t2vModelId} 已注册: ${t2vId}`);
}

// ================================================================
// 3. 更新任务分工 → T2V 模型
// ================================================================
console.log('\n3. 更新任务分工...');

let config: any = {};
if (existsSync(CONFIG_PATH)) {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

if (!config.models) config.models = {};
if (!config.models.tasks) config.models.tasks = {};

const oldVideo = config.models.tasks.video;
config.models.tasks.video = t2vModelId;

writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
console.log(`   ✅ 任务分工 video: "${oldVideo}" → "${t2vModelId}"`);

// ================================================================
// 4. 验证
// ================================================================
console.log('\n=== 验证结果 ===');

console.log('\n📋 视频生成模型:');
const videoModels = db
  .query("SELECT model_id, display_name, capabilities, enabled, provider_id FROM model_registry WHERE capabilities LIKE '%video_generation%'")
  .all() as any[];
videoModels.forEach((m: any) => {
  const caps = JSON.parse(m.capabilities || '[]');
  const prov = db.query("SELECT name, provider_type, base_url, is_active FROM ai_providers WHERE id = ?")
    .get(m.provider_id) as any;
  console.log(`  ${m.model_id} (${m.display_name || '-'})`);
  console.log(`    capabilities: ${JSON.stringify(caps)}`);
  console.log(`    enabled: ${!!m.enabled}`);
  console.log(`    provider: ${prov?.name} (${prov?.provider_type})`);
  console.log(`    base_url: ${prov?.base_url}`);
});

console.log('\n📋 任务分工:');
console.log(JSON.stringify(config.models.tasks, null, 2));

console.log('\n📋 环境变量:');
const falKey = process.env.FAL_KEY || process.env.FAL_API_KEY;
console.log(`  FAL_KEY: ${falKey ? 'YES' : 'NO'}`);
const siliconKey = process.env.SILICONFLOW_API_KEY;
console.log(`  SILICONFLOW_API_KEY: ${siliconKey ? 'YES' : 'NO'}`);

db.close();

console.log('\n=== 修复完成 ===');
console.log('\n运行测试:');
console.log('  cd app && bun test src/tools/VideoGenerateTool/__tests__/VideoGenerateTool.test.ts');