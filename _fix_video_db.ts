/**
 * DB 维护脚本 — 修复视频模型数据
 *
 * 使用前请先停止应用！
 * 修复内容:
 *   1. 禁用已下线的 SiliconFlow 视频模型
 *   2. 注册新的有效视频模型
 *   3. 更新现有模型的能力标签
 *
 * 运行: bun run _fix_video_db.ts
 */
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const dbPath = join(homedir(), '.pyapp', 'data', 'app.db');
const db = new Database(dbPath);

console.log('=== DB 视频模型修复 ===\n');

// ================================================================
// 1. 禁用已下线的模型
// ================================================================
const deprecatedModels = [
  'Lightricks/LTX-Video',
  'tencent/HunyuanVideo',
  'genmo/mochi-1-preview',
];

console.log('1. 禁用已下线模型:');
for (const modelId of deprecatedModels) {
  const result = db.run(
    'UPDATE model_registry SET enabled = 0 WHERE model_id = ?',
    [modelId]
  );
  console.log(`   ${modelId}: ${result.changes > 0 ? '已禁用' : '未找到'}`);
}

// ================================================================
// 2. 修复 Wan2.2-I2V-A14B 的能力标签
// ================================================================
db.run(
  `UPDATE model_registry SET capabilities = ? WHERE model_id = ?`,
  [JSON.stringify(['image_to_video', 'video_generation']), 'Wan-AI/Wan2.2-I2V-A14B']
);
console.log('\n2. Wan-AI/Wan2.2-I2V-A14B 能力标签已更新');

// ================================================================
// 3. 注册新的 SiliconFlow 视频模型
// ================================================================
const siliconFlowProviderId = '046cf0b3-4348-439f-8791-6789e3c7d260';

const newModels = [
  {
    modelId: 'Wan-AI/Wan2.2-T2V-A14B',
    displayName: 'Wan 2.2 T2V (SiliconFlow)',
    capabilities: JSON.stringify(['text_to_video', 'video_generation']),
  },
  {
    modelId: 'Wan-AI/Wan2.1-T2V-14B',
    displayName: 'Wan 2.1 T2V (SiliconFlow)',
    capabilities: JSON.stringify(['text_to_video', 'video_generation']),
  },
  {
    modelId: 'Wan-AI/Wan2.1-T2V-14B-Turbo',
    displayName: 'Wan 2.1 T2V Turbo (SiliconFlow)',
    capabilities: JSON.stringify(['text_to_video', 'video_generation']),
  },
  {
    modelId: 'Wan-AI/Wan2.1-I2V-14B-720P',
    displayName: 'Wan 2.1 I2V 720P (SiliconFlow)',
    capabilities: JSON.stringify(['image_to_video', 'video_generation']),
  },
];

console.log('\n3. 注册新模型:');
for (const m of newModels) {
  const existing = db.query('SELECT id FROM model_registry WHERE model_id = ?').get(m.modelId);
  if (existing) {
    db.run(
      'UPDATE model_registry SET enabled = 1, capabilities = ?, display_name = ? WHERE model_id = ?',
      [m.capabilities, m.displayName, m.modelId]
    );
    console.log(`   ${m.modelId}: 已更新`);
  } else {
    const uuid = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.run(
      `INSERT INTO model_registry (id, model_id, display_name, capabilities, enabled, provider_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [uuid, m.modelId, m.displayName, m.capabilities, siliconFlowProviderId, now, now]
    );
    console.log(`   ${m.modelId}: 已注册`);
  }
}

// ================================================================
// 4. 最终状态
// ================================================================
console.log('\n=== 修复后视频模型状态 ===');
const models = db.query(
  "SELECT model_id, display_name, capabilities, enabled FROM model_registry WHERE capabilities LIKE '%video%'"
).all();
for (const m of models as any[]) {
  console.log(`   [${m.enabled ? '启用' : '禁用'}] ${m.model_id}`);
}

db.close();
console.log('\n修复完成！请重新启动应用。');
