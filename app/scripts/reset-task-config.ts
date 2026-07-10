/**
 * 重置模型任务配置（清除 UUID 迁移残留）
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.pyapp', 'config.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

// 确保 models.tasks 使用模型名而非 UUID
if (!config.models) config.models = {};
if (!config.models.tasks) config.models.tasks = {};

// T2V 模型
config.models.tasks.video = 'tencent/HunyuanVideo';

writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

console.log('已重置任务分工:');
console.log(JSON.stringify(config.models.tasks, null, 2));

// 检查是否有 UUID 残留
for (const [key, value] of Object.entries(config.models.tasks)) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value as string);
  if (isUuid) {
    console.log(`⚠️ 警告: ${key} 仍然是 UUID: ${value}`);
  }
}