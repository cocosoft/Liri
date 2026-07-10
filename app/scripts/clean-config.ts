import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const CONFIG_PATH = 'e:/PY/CODES/PY_APP/app/data/pyapp/config.json';
const BACKUP_DIR = 'e:/PY/CODES/PY_APP/app/data/pyapp/data/backups/app';

// 备份
const ts = new Date().toISOString().replace(/:/g, '-');
copyFileSync(CONFIG_PATH, join(BACKUP_DIR, `config-cleanup-${ts}.json`));

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

// 清理 models.tasks 嵌套垃圾
if (config.models && config.models.tasks) {
  // 从嵌套结构中提取正确的 tasks
  const tasks = config.models.tasks;
  
  // 清理嵌套的 tasks.tasks.tasks...
  const cleanTasks: Record<string, string> = {};
  const extractTasks = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key === 'tasks' || key === 'modelNames') continue;
      if (typeof obj[key] === 'string') {
        cleanTasks[key] = obj[key];
      } else if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        extractTasks(obj[key]);
      }
    }
  };
  extractTasks(tasks);
  
  // 确保 video 任务存在
  if (!cleanTasks.video) {
    cleanTasks.video = 'Wan-AI/Wan2.2-I2V-A14B';
  }
  
  config.models.tasks = cleanTasks;
  console.log('清理后的 tasks:');
  console.log(JSON.stringify(config.models.tasks, null, 2));
}

writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
console.log('\n✅ config.json 已清理并保存');