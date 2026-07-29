/**
 * 内置默认模型数据
 * 从 models.default.yaml 加载，提供首次启动时的模型配置基线
 * 兜底回退到内联数据（YAML 文件不存在时）
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load, dump } from 'js-yaml';

import { handleError } from '@modules/error';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ModelYamlConfig {
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities?: string[];
  providers: Record<string, string>;
  pricing?: {
    inputPer1M: number;
    outputPer1M: number;
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
  };
  extendedContextWindows?: Array<{ suffix: string; windowSize: number }>;
}

export interface DefaultModelsData {
  version: string;
  description: string;
  models: Record<string, ModelYamlConfig>;
}

/**
 * 内联回退数据（YAML 文件不存在时使用）
 */
const INLINE_FALLBACK: DefaultModelsData = {
  version: '1.0.0',
  description: '内联回退模型配置',
  models: {},
};

let cachedDefaultModels: DefaultModelsData | null = null;

const DEFAULT_MODELS_YAML_PATH = join(__dirname, 'models.default.yaml');

/**
 * 尝试找到 YAML 文件的路径
 */
function findYamlPath(): string | null {
  const candidates = [
    join(process.cwd(), 'src/ai/config/models.default.yaml'),
    DEFAULT_MODELS_YAML_PATH,
    join(process.cwd(), 'dist/ai/config/models.default.yaml'),
    // 支持从脚本目录执行的情况
    join(process.cwd(), '../app/src/ai/config/models.default.yaml'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 加载内置默认模型配置
 * 优先从 YAML 文件加载，兜底使用内联数据
 */
export function loadDefaultModels(): DefaultModelsData {
  if (cachedDefaultModels) {
    return cachedDefaultModels;
  }

  const yamlPath = findYamlPath();
  if (yamlPath) {
    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      const data = load(raw) as DefaultModelsData;
      if (data?.models && Object.keys(data.models).length > 0) {
        cachedDefaultModels = data;
        return cachedDefaultModels;
      }
    } catch (err) {
      // 文件损坏时忽略，走内联回退
      handleError(err, { module: 'ai:config', action: 'loadDefaultModels' });
    }
  }

  // 兜底：内联数据
  cachedDefaultModels = INLINE_FALLBACK;
  return cachedDefaultModels;
}

/**
 * 注册模型到内联回退（用于脚本生成或 Provider 动态注册）
 */
export function registerFallbackModel(
  key: string,
  config: ModelYamlConfig
): void {
  INLINE_FALLBACK.models[key] = config;
}

/**
 * 持久化当前模型到 YAML 文件
 */
export function persistDefaultModels(data: DefaultModelsData): string {
  const yamlContent = dump(data, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: true,
  });
  const yamlPath =
    findYamlPath() || join(process.cwd(), 'src/ai/config/models.default.yaml');
  const dir = dirname(yamlPath);
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs');
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(yamlPath, yamlContent, 'utf-8');
  return yamlPath;
}

/**
 * 清空缓存（通常在测试中使用）
 */
export function clearDefaultModelsCache(): void {
  cachedDefaultModels = null;
}
