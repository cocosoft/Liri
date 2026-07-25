/**
 * 统一环境变量供应商检测工具
 *
 * 混合方案：
 *   1. 统一格式（PROVIDER_{NAME}_KEY）— 支持任意供应商
 *   2. 专用变量名（DEEPSEEK_API_KEY 等）— 大厂专用，兼顾商业价值
 *
 * 优先顺序：统一格式 > 专用变量名
 * 同一供应商同时存在两种格式时，统一格式胜出。
 *
 * ── 统一格式 ──
 *   PROVIDER_{NAME}_KEY=sk-xxx       # 必选，标识一个供应商
 *   PROVIDER_{NAME}_TYPE=deepseek     # 可选，默认 "custom"
 *   PROVIDER_{NAME}_URL=<base-url>    # 可选
 *   PROVIDER_{NAME}_MODEL=<model>     # 可选
 *
 * 示例：
 *   PROVIDER_DEEPSEEK_KEY=sk-xxx
 *   PROVIDER_DEEPSEEK_TYPE=deepseek
 *   PROVIDER_DEEPSEEK_URL=https://api.deepseek.com
 *
 *   PROVIDER_MISTRAL_KEY=sk-xxx       # 小供应商也无需预知
 *   PROVIDER_MISTRAL_URL=https://api.mistral.ai/v1
 *
 * ── 专用变量名 ──
 *   DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
 *   OPENAI_API_KEY / OPENAI_BASE_URL
 *   ANTHROPIC_API_KEY
 *   GOOGLE_API_KEY / GEMINI_API_KEY / GOOGLE_AI_BASE_URL
 *   SILICONFLOW_API_KEY
 *
 *   NAME 段规则：大写字母、数字、下划线（A-Z、0-9、_）
 */
import type { ProviderType } from './ProviderManager';

/** 检测出的供应商配置 */
export interface UnifiedProviderConfig {
  /** 供应商标识名（小写化） */
  name: string;
  /** 供应商类型，默认 "custom" */
  providerType: string;
  /** API Key */
  apiKey?: string;
  /** 基础 URL */
  baseUrl?: string;
  /** 默认模型 */
  model?: string;
}

/** PROVIDER_{NAME}_KEY 正则 */
const KEY_PATTERN = /^PROVIDER_([A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)*)_KEY$/;

// ── 专用变量名映射表 ──
// 大厂的专用环境变量名映射到统一配置格式

interface LegacyMapping {
  name: string;
  providerType: ProviderType;
  defaultUrl?: string;
}

/** KEY → 供应商元信息 */
const LEGACY_KEYS: Record<string, LegacyMapping> = {
  DEEPSEEK_API_KEY: {
    name: 'deepseek',
    providerType: 'deepseek',
    defaultUrl: 'https://api.deepseek.com',
  },
  OPENAI_API_KEY: {
    name: 'openai',
    providerType: 'openai',
    defaultUrl: 'https://api.openai.com/v1',
  },
  ANTHROPIC_API_KEY: {
    name: 'anthropic',
    providerType: 'anthropic',
    defaultUrl: 'https://api.anthropic.com',
  },
  GOOGLE_API_KEY: {
    name: 'google',
    providerType: 'google',
    defaultUrl: 'https://generativelanguage.googleapis.com',
  },
  GEMINI_API_KEY: {
    name: 'google',
    providerType: 'google',
    defaultUrl: 'https://generativelanguage.googleapis.com',
  },
  SILICONFLOW_API_KEY: {
    name: 'siliconflow',
    providerType: 'custom',
    defaultUrl: 'https://api.siliconflow.cn/v1',
  },
  // Phase 3: Ollama local model support (VerifierAgent offline-friendly)
  OLLAMA_BASE_URL: {
    name: 'ollama',
    providerType: 'custom',
    defaultUrl: 'http://localhost:11434/v1',
  },
};

/** 专用 URL 后缀 → 对应的 KEY 环境变量 */
const LEGACY_URLS: Record<string, string> = {
  DEEPSEEK_BASE_URL: 'DEEPSEEK_API_KEY',
  OPENAI_BASE_URL: 'OPENAI_API_KEY',
  GOOGLE_AI_BASE_URL: 'GOOGLE_API_KEY',
};

/** 专用 MODEL 后缀 → 对应的 KEY 环境变量 */
const LEGACY_MODELS: Record<string, string> = {
  DEEPSEEK_MODEL: 'DEEPSEEK_API_KEY',
};

/**
 * 检测统一格式的供应商（PROVIDER_{NAME}_KEY）
 */
function detectNewFormat(): UnifiedProviderConfig[] {
  const providers: UnifiedProviderConfig[] = [];

  for (const envKey of Object.keys(process.env)) {
    const match = envKey.match(KEY_PATTERN);
    if (!match) continue;

    const rawValue = process.env[envKey];
    if (!rawValue) continue;

    const rawName = match[1];
    const name = rawName.toLowerCase();

    const typeKey = `PROVIDER_${rawName}_TYPE`;
    const urlKey = `PROVIDER_${rawName}_URL`;
    const modelKey = `PROVIDER_${rawName}_MODEL`;

    providers.push({
      name,
      providerType: process.env[typeKey] || 'custom',
      apiKey: rawValue,
      baseUrl: process.env[urlKey] || undefined,
      model: process.env[modelKey] || undefined,
    });
  }

  return providers;
}

/**
 * 检测专用变量名的供应商（DEEPSEEK_API_KEY 等）
 *
 * 如果某个供应商已通过统一格式检测到，则跳过。
 */
function detectLegacyFormat(
  newProviderNames: Set<string>
): UnifiedProviderConfig[] {
  const providers: UnifiedProviderConfig[] = [];

  for (const [envKey, mapping] of Object.entries(LEGACY_KEYS)) {
    if (newProviderNames.has(mapping.name)) continue;

    const apiKey = process.env[envKey];
    if (!apiKey) continue;

    // 查找配套 URL
    let baseUrl = mapping.defaultUrl;
    for (const [urlEnv, keyEnv] of Object.entries(LEGACY_URLS)) {
      if (keyEnv === envKey) {
        const urlValue = process.env[urlEnv];
        if (urlValue) {
          baseUrl = urlValue;
          break;
        }
      }
    }

    // 查找配套 MODEL
    let model: string | undefined;
    for (const [modelEnv, keyEnv] of Object.entries(LEGACY_MODELS)) {
      if (keyEnv === envKey) {
        const modelValue = process.env[modelEnv];
        if (modelValue) {
          model = modelValue;
          break;
        }
      }
    }

    providers.push({
      name: mapping.name,
      providerType: mapping.providerType,
      apiKey,
      baseUrl,
      model,
    });
  }

  return providers;
}

/**
 * 统一检测所有通过环境变量配置的供应商
 *
 * 1. 扫描统一格式（PROVIDER_{NAME}_KEY）
 * 2. 扫描专用变量名，跳过已通过统一格式注册的供应商
 * 3. 返回合并列表（统一格式优先）
 */
export function detectUnifiedProviders(): UnifiedProviderConfig[] {
  const newProviders = detectNewFormat();
  const newNames = new Set(newProviders.map((p) => p.name));
  const legacyProviders = detectLegacyFormat(newNames);

  return [...newProviders, ...legacyProviders];
}

/**
 * 将供应商标识名格式化为友好的显示名
 *
 * "deepseek" → "DeepSeek"
 * "siliconflow" → "SiliconFlow"
 * "my_llm" → "My Llm"
 */
export function formatEnvProviderName(name: string): string {
  return name
    .split('_')
    .map((part) => {
      if (part.length <= 2) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}
