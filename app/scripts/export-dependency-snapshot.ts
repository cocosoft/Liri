/**
 * 依赖图快照导出脚本
 * 将当前模块依赖关系导出为基准快照，用于后续变更检测
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { MODULE_DEFINITIONS, MODULE_INITIALIZATION_ORDER } from '../src/modules/ModuleDefinitions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 快照数据接口
 */
interface DependencySnapshot {
  version: string;
  generatedAt: string;
  description: string;
  modules: Record<string, {
    id: string;
    name: string;
    category: string;
    version: string;
    dependencies: string[];
    optionalDependencies: string[];
  }>;
  initializationOrder: string[];
  fingerprint: string;
}

/**
 * 生成快照指纹
 */
function generateFingerprint(data: object): string {
  return createHash('sha256')
    .update(JSON.stringify(data, null, 2))
    .digest('hex')
    .substring(0, 16);
}

/**
 * 导出依赖图快照
 */
function exportSnapshot(): void {
  const modules: DependencySnapshot['modules'] = {};

  for (const [id, def] of Object.entries(MODULE_DEFINITIONS)) {
    modules[id] = {
      id: def.id,
      name: def.name,
      category: def.category,
      version: def.version,
      dependencies: [...def.dependencies],
      optionalDependencies: [...def.optionalDependencies]
    };
  }

  const snapshot: DependencySnapshot = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    description: 'Liri 模块依赖关系基准快照 — 记录批准的基础架构',
    modules,
    initializationOrder: [...MODULE_INITIALIZATION_ORDER],
    fingerprint: ''
  };

  snapshot.fingerprint = generateFingerprint({
    modules: snapshot.modules,
    initializationOrder: snapshot.initializationOrder
  });

  const outputPath = join(__dirname, '..', 'dependency-snapshot.json');
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');

  const moduleCount = Object.keys(snapshot.modules).length;
  console.log(`✅ 依赖图快照已导出: dependency-snapshot.json`);
  console.log(`   模块数量: ${moduleCount}`);
  console.log(`   初始化顺序: ${snapshot.initializationOrder.length} 个阶段`);
  console.log(`   指纹: ${snapshot.fingerprint}`);
}

exportSnapshot();
