/**
 * 视频生成测试环境准备脚本
 * 1. 修复视频模型 ID（为空的生成 UUID）
 * 2. 显示当前配置状态
 */
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { copyFileSync } from 'fs';

const srcPath = join(homedir(), '.pyapp', 'data', 'app.db');
const tmpPath = join(homedir(), '.pyapp', 'data', 'app_setup_tmp.db');

copyFileSync(srcPath, tmpPath);
const db = new Database(tmpPath);

// 1. 修复视频模型空 ID
const videoModel = db
  .prepare(
    "SELECT rowid, id, model_id FROM model_registry WHERE capabilities LIKE '%video_generation%'"
  )
  .get() as any;

if (videoModel && !videoModel.id) {
  const newId = randomUUID();
  db.prepare('UPDATE model_registry SET id = ? WHERE rowid = ?').run(
    newId,
    videoModel.rowid
  );
  console.log(`已修复视频模型 ID: ${videoModel.model_id} → ${newId}`);
} else if (videoModel) {
  console.log(`视频模型 ID 正常: ${videoModel.id}`);
} else {
  console.log('未找到视频模型');
}

// 2. 显示当前状态
console.log('\n=== 视频模型 ===');
const models = db
  .prepare(
    "SELECT id, model_id, display_name, capabilities, enabled, provider_id FROM model_registry WHERE capabilities LIKE '%video_generation%'"
  )
  .all();
models.forEach((m: any) => {
  console.log(`  id:       ${m.id}`);
  console.log(`  model_id: ${m.model_id}`);
  console.log(`  display:  ${m.display_name}`);
  console.log(`  enabled:  ${m.enabled}`);
  console.log(`  provider: ${m.provider_id}`);
});

console.log('\n=== FAL 供应商 ===');
const provider = db
  .prepare(
    'SELECT id, name, provider_type, api_key, base_url, is_active FROM ai_providers WHERE provider_type = ?'
  )
  .get('fal') as any;
if (provider) {
  console.log(`  id:      ${provider.id}`);
  console.log(`  name:    ${provider.name}`);
  console.log(`  type:    ${provider.provider_type}`);
  console.log(`  baseUrl: ${provider.base_url}`);
  console.log(`  active:  ${provider.is_active}`);
  console.log(
    `  apiKey:  ${provider.api_key ? '已配置' : '未配置 (需要设置)'}`
  );
}

console.log('\n=== 任务分工配置 ===');
const configs = db.prepare('SELECT * FROM ai_app_model_configs').all();
configs.forEach((c: any) => console.log(JSON.stringify(c)));

db.close();

// 如果 DB 未被锁定，直接写入
try {
  const db2 = new Database(srcPath);
  if (videoModel && !videoModel.id) {
    const newId = randomUUID();
    db2
      .prepare('UPDATE model_registry SET id = ? WHERE model_id = ?')
      .run(newId, videoModel.model_id);
    console.log(`\n已直接写入 DB: ${videoModel.model_id} → ${newId}`);
  }
  db2.close();
} catch {
  console.log(
    '\nDB 被锁定，无法直接写入。请关闭应用后重新运行此脚本。'
  );
}

console.log('\n使用说明:');
console.log(
  '  1. 设置 FAL API Key: 模型管理 UI → 供应商 → FAL.ai → 编辑 → 填写 API Key'
);
console.log(
  '  2. 或设置环境变量: $env:FAL_KEY="your-fal-api-key"'
);
console.log(
  '  3. 运行测试: cd app && npx bun test src/tools/VideoGenerateTool/__tests__/VideoGenerateTool.test.ts'
);