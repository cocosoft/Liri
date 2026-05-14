import type {
  ModelPickerResult,
  FlowContext,
  FlowConfigProvider,
  FlowOption,
} from './types.js';

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

const DEFAULT_MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    contextWindow: 128000,
    capabilities: ['text', 'vision'],
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    contextWindow: 128000,
    capabilities: ['text', 'vision'],
  },
  {
    id: 'gpt-4-turbo',
    provider: 'openai',
    name: 'GPT-4 Turbo',
    contextWindow: 128000,
    capabilities: ['text', 'vision'],
  },
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    contextWindow: 200000,
    capabilities: ['text', 'vision'],
  },
  {
    id: 'claude-haiku-3-5',
    provider: 'anthropic',
    name: 'Claude Haiku 3.5',
    contextWindow: 200000,
    capabilities: ['text', 'vision'],
  },
  {
    id: 'gemini-2.0-flash',
    provider: 'google',
    name: 'Gemini 2.0 Flash',
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'audio'],
  },
  {
    id: 'gemini-1.5-pro',
    provider: 'google',
    name: 'Gemini 1.5 Pro',
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'audio'],
  },
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    name: 'DeepSeek Chat',
    contextWindow: 64000,
    capabilities: ['text'],
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    name: 'DeepSeek Reasoner',
    contextWindow: 64000,
    capabilities: ['text'],
  },
  {
    id: 'llama-3.1-70b',
    provider: 'meta',
    name: 'Llama 3.1 70B',
    contextWindow: 128000,
    capabilities: ['text'],
  },
  {
    id: 'llama-3.1-405b',
    provider: 'meta',
    name: 'Llama 3.1 405B',
    contextWindow: 128000,
    capabilities: ['text'],
  },
  {
    id: 'mistral-large',
    provider: 'mistral',
    name: 'Mistral Large',
    contextWindow: 128000,
    capabilities: ['text'],
  },
  {
    id: 'command-r-plus',
    provider: 'cohere',
    name: 'Command R+',
    contextWindow: 128000,
    capabilities: ['text'],
  },
];

const modelCatalog: Map<string, ModelCatalogEntry> = new Map();

for (const entry of DEFAULT_MODEL_CATALOG) {
  modelCatalog.set(entry.id, entry);
}

/**
 * 向目录注册模型。
 */
export function registerModel(entry: ModelCatalogEntry): void {
  modelCatalog.set(entry.id, entry);
}

/**
 * 批量注册模型。
 */
export function registerModels(entries: ModelCatalogEntry[]): void {
  for (const entry of entries) {
    registerModel(entry);
  }
}

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
