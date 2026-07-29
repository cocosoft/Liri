import type {
  ModelPickerResult,
  FlowContext,
  FlowConfigProvider,
  FlowOption,
} from './types.js';
import { modelManager } from '@modules/ai';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'core:flows:model-picker',
  level: LogLevel.INFO,
});

export type ModelCatalogEntry = {
  id: string;
  provider: string;
  name: string;
  contextWindow?: number;
  capabilities?: string[];
  costPer1KTokens?: { input: number; output: number };
};

export type ModelPickerOptions = {
  allowKeep?: boolean;
  includeManual?: boolean;
  preferredProvider?: string;
  message?: string;
  filter?: (entry: ModelCatalogEntry) => boolean;
};

/**
 * 从 ModelManager 动态加载模型目录
 */
function loadModelCatalog(): Map<string, ModelCatalogEntry> {
  const catalog = new Map<string, ModelCatalogEntry>();
  try {
    const registry = modelManager.getModelRegistry();
    // 如果注册表为空，自动加载默认模型（测试等无启动流程的场景）
    if (registry.getAllModels().length === 0) {
      registry.loadDefaultModels();
    }
    const models = modelManager.getModelInfoList();
    for (const info of models) {
      const provider = extractProviderFromId(info.id);
      catalog.set(info.id, {
        id: info.id,
        provider,
        name: info.name,
        contextWindow: parseContextWindow(info.description),
        capabilities: ['text'],
      });
    }
  } catch (err) {
    // ModelManager 不可用时使用空目录

    handleError(err, {
      module: 'core:flows',
      action: 'buildCatalog',
    });
  }
  return catalog;
}

/**
 * 从模型 ID 推断提供商
 */
function extractProviderFromId(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (
    lower.startsWith('claude-') ||
    lower.includes('opus') ||
    lower.includes('sonnet') ||
    lower.includes('haiku')
  )
    return 'anthropic';
  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  )
    return 'openai';
  if (lower.startsWith('gemini-')) return 'google';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('llama')) return 'meta';
  if (lower.includes('mistral')) return 'mistral';
  if (lower.includes('command')) return 'cohere';
  if (lower.includes('moonshot')) return 'moonshot';
  if (lower.includes('grok')) return 'grok';
  return 'other';
}

/**
 * 从描述文本解析上下文窗口大小
 */
function parseContextWindow(description: string): number {
  const match = description.match(/([\d,]+)\s*tokens/);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return 200000;
}

const modelCatalog: Map<string, ModelCatalogEntry> = loadModelCatalog();

/**
 * 根据 ID 获取模型信息。
 */
export function getModel(modelId: string): ModelCatalogEntry | undefined {
  return modelCatalog.get(modelId);
}

/**
 * 获取经过过滤的模型目录。
 */
export function listModels(
  filter?: (entry: ModelCatalogEntry) => boolean
): ModelCatalogEntry[] {
  const entries = Array.from(modelCatalog.values());
  return filter ? entries.filter(filter) : entries;
}

/**
 * 按提供商分组列出模型。
 */
export function listModelsByProvider(provider: string): ModelCatalogEntry[] {
  return listModels((e) => e.provider === provider);
}

/**
 * 列出所有可用的提供商。
 */
export function listProviders(): string[] {
  const providers = new Set<string>();
  for (const entry of modelCatalog.values()) {
    providers.add(entry.provider);
  }
  return Array.from(providers).sort();
}

/**
 * 提示用户选择模型并应用配置。
 */
export async function pickModel(
  options: ModelPickerOptions = {},
  context: FlowContext = {},
  configProvider: FlowConfigProvider
): Promise<ModelPickerResult> {
  let available = listModels(options.filter);

  if (options.preferredProvider) {
    const preferred = available.filter(
      (e) => e.provider === options.preferredProvider
    );
    if (preferred.length > 0) {
      available = preferred;
    }
  }

  if (available.length === 0) {
    return { model: undefined, provider: undefined };
  }

  const selected = available[0];

  configProvider.set('agents.defaults.model', selected.id);
  configProvider.set('agents.defaults.provider', selected.provider);

  return {
    model: selected.id,
    provider: selected.provider,
    config: {
      model: selected.id,
      provider: selected.provider,
    },
  };
}

/**
 * 获取模型选择选项列表（用于交互式向导）。
 */
export function getModelPickerOptions(
  options: ModelPickerOptions = {}
): FlowOption[] {
  const entries = listModels(options.filter);

  return entries.map((entry) => ({
    value: entry.id,
    label: `${entry.provider}/${entry.name}`,
    hint: entry.contextWindow
      ? `${entry.contextWindow.toLocaleString()} ctx`
      : undefined,
    group: { id: entry.provider, label: entry.provider },
  }));
}

/**
 * 解析模型字符串为结构化信息。
 */
export function parseModelRef(modelRef: string): {
  provider?: string;
  model: string;
} {
  const slashIndex = modelRef.indexOf('/');
  if (slashIndex > 0) {
    return {
      provider: modelRef.slice(0, slashIndex),
      model: modelRef.slice(slashIndex + 1),
    };
  }
  return { model: modelRef };
}
