/**
 * 视频生成环境一键配置脚本
 *
 * 执行内容：
 *  1. 修复 Wan-AI/Wan2.2-I2V-A14B capabilities → ["video_generation"]
 *  2. 注册 FAL 供应商到 ai_providers 表
 *  3. 注册 fal-ai/kling-video/v2.1 模型到 model_registry
 *  4. 更新 config.json 任务分工 → video: "Wan-AI/Wan2.2-I2V-A14B"
 *  5. 验证所有配置
 *
 * 用法: cd app && bun run scripts/setup-video-env.ts
 */

import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DB_PATH = join(homedir(), '.pyapp', 'data', 'app.db');
const CONFIG_PATH = join(homedir(), '.pyapp', 'config.json');
const BACKUP_DIR = join(homedir(), '.pyapp', 'data', 'backups', 'app');

// ================================================================
// 0. 备份
// ================================================================

console.log('📦 备份数据库...');
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = join(BACKUP_DIR, `app-${new Date().toISOString().replace(/:/g, '-')}.db`);
copyFileSync(DB_PATH, backupPath);
console.log(`  已备份到: ${backupPath}`);

// 备份 config.json
const configBackupPath = join(BACKUP_DIR, `config-${new Date().toISOString().replace(/:/g, '-')}.json`);
copyFileSync(CONFIG_PATH, configBackupPath);
console.log(`  已备份 config.json 到: ${configBackupPath}`);

// ================================================================
// 1. 打开数据库
// ================================================================

const db = new Database(DB_PATH);

// ================================================================
// 2. 修复 Wan-AI 模型 capabilities
// ================================================================

console.log('\n🔧 修复 Wan-AI 模型 capabilities...');
const wanModel = db
  .prepare("SELECT id, model_id, capabilities FROM model_registry WHERE model_id = 'Wan-AI/Wan2.2-I2V-A14B'")
  .get() as any;

if (wanModel) {
  const currentCaps = JSON.parse(wanModel.capabilities || '[]');
  const needsVideoGen = !currentCaps.includes('video_generation');
  const needsImageGen = !currentCaps.includes('image_generation');

  if (needsVideoGen || needsImageGen) {
    const newCaps = [...new Set([...currentCaps, 'video_generation', 'image_generation'])];
    db.prepare('UPDATE model_registry SET capabilities = ? WHERE id = ?').run(
      JSON.stringify(newCaps),
      wanModel.id
    );
    console.log(`  ✅ Wan-AI capabilities: ${JSON.stringify(currentCaps)} → ${JSON.stringify(newCaps)}`);
  } else {
    console.log(`  ✅ Wan-AI capabilities 已正确: ${JSON.stringify(currentCaps)}`);
  }
} else {
  console.log('  ❌ 未找到 Wan-AI/Wan2.2-I2V-A14B 模型');
}

// ================================================================
// 3. 注册 FAL 供应商
// ================================================================

console.log('\n🔧 注册 FAL 供应商...');
const existingFal = db
  .prepare("SELECT id FROM ai_providers WHERE provider_type = 'fal'")
  .get() as any;

let falProviderId: string;

if (existingFal) {
  falProviderId = existingFal.id;
  console.log(`  ✅ FAL 供应商已存在: ${falProviderId}`);
} else {
  falProviderId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO ai_providers (id, name, provider_type, api_key, base_url, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    falProviderId,
    'FAL.ai',
    'fal',
    '', // API Key 留空，通过环境变量 FAL_KEY 或 FAL_API_KEY 设置
    'https://fal.run',
    1, // is_active = true
    now,
    now
  );
  console.log(`  ✅ FAL 供应商已注册: ${falProviderId}`);
}

// ================================================================
// 4. 注册 FAL 视频模型
// ================================================================

console.log('\n🔧 注册 FAL 视频模型...');
const existingKling = db
  .prepare("SELECT id FROM model_registry WHERE model_id = 'fal-ai/kling-video/v2.1'")
  .get() as any;

if (existingKling) {
  console.log(`  ✅ Kling 2.1 模型已存在: ${existingKling.id}`);
} else {
  const klingId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO model_registry (id, model_id, display_name, context_window, max_output_tokens,
      capabilities, provider_mappings, input_price, output_price, cache_read_price, cache_write_price,
      provider_id, enabled, is_custom, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    klingId,
    'fal-ai/kling-video/v2.1',
    'Kling 2.1 (FAL)',
    200000,
    4096,
    JSON.stringify(['video_generation', 'image_generation']),
    '{}',
    0.5,  // input_price
    0,    // output_price
    0,    // cache_read_price
    0,    // cache_write_price
    falProviderId,
    1,    // enabled
    1,    // is_custom
    now,
    now
  );
  console.log(`  ✅ Kling 2.1 模型已注册: ${klingId}`);
}

// ================================================================
// 5. 更新 config.json 任务分工
// ================================================================

console.log('\n🔧 更新任务分工...');
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

if (!config.models) config.models = {};
if (!config.models.tasks) config.models.tasks = {};

// 设置 video 任务 → Wan-AI（SiliconFlow，支持图生视频）
// FAL Kling 需要 API Key，当前优先使用硅基流动
config.models.tasks.video = 'Wan-AI/Wan2.2-I2V-A14B';

writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
console.log(`  ✅ 任务分工 video → ${config.models.tasks.video}`);

// ================================================================
// 6. 验证
// ================================================================

console.log('\n=== 验证结果 ===');

// 6.1 视频模型
console.log('\n📋 视频生成模型:');
const videoModels = db
  .query("SELECT model_id, display_name, capabilities, enabled, provider_id FROM model_registry WHERE capabilities LIKE '%video_generation%'")
  .all() as any[];
videoModels.forEach((m: any) => {
  const caps = JSON.parse(m.capabilities || '[]');
  console.log(`  ${m.model_id} (${m.display_name || '-'})`);
  console.log(`    capabilities: ${JSON.stringify(caps)}`);
  console.log(`    enabled: ${!!m.enabled}`);
  console.log(`    provider_id: ${m.provider_id}`);
});

// 6.2 供应商
console.log('\n📋 供应商:');
const providers = db
  .query('SELECT id, name, provider_type, is_active FROM ai_providers')
  .all() as any[];
providers.forEach((p: any) => {
  console.log(`  ${p.name} (${p.provider_type}) - active: ${!!p.is_active}`);
});

// 6.3 任务分工
console.log('\n📋 任务分工:');
console.log(JSON.stringify(config.models.tasks, null, 2));

// 6.4 环境变量检查
console.log('\n📋 环境变量:');
const falKey = process.env.FAL_KEY || process.env.FAL_API_KEY;
console.log(`  FAL_KEY: ${falKey ? '✅ 已设置' : '⚠️ 未设置 (文生视频需要)'}`);
const siliconKey = process.env.SILICONFLOW_API_KEY;
console.log(`  SILICONFLOW_API_KEY: ${siliconKey ? '✅ 已设置' : '⚠️ 未设置 (图生视频需要)'}`);

db.close();

console.log('\n=== 配置完成 ===');
console.log('运行测试: cd app && bun test src/tools/VideoGenerateTool/__tests__/VideoGenerateTool.test.ts');