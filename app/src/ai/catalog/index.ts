// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * AI Model Catalog
 *
 * @deprecated 此模块已废弃，使用 ai/models/ModelConfigs.ts 作为单一事实源。
 *   - ALL_MODEL_CONFIGS 替代 MODEL_CATALOG
 *   - ModelConfig 替代 ModelEntry
 *   - APIProvider 替代 ModelProvider
 *   - ModelCapability (types.ts) 替代 ModelCapabilityFlag
 *   - getModelsByProvider() / getModelsWithCapability() 替代 ModelCatalog 实例方法
 *   保留此文件仅为兼容过渡，新代码禁止引用。
 */

export type ModelProvider =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'google'
  | 'azure'
  | 'aws'
  | 'ollama'
  | 'custom';

export type ModelCapabilityFlag =
  | 'streaming'
  | 'function_calling'
  | 'vision'
  | 'thinking'
  | 'extended_thinking'
  | 'tool_use'
  | 'computer_use'
  | 'context_caching'
  | 'structured_output'
  | 'parallel_tool_calls'
  | 'image_input'
  | 'pdf_input'
  | 'code_execution';

export interface ModelEntry {
  id: string;
  name: string;
  provider: ModelProvider;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilityFlag[];
  pricing?: {
    inputPer1M: number;
    outputPer1M: number;
  };
  aliases?: string[];
  deprecated?: boolean;
  releasedAt?: string;
}

export interface ModelFamily {
  name: string;
  provider: ModelProvider;
  description: string;
  models: ModelEntry[];
}

const MODEL_CATALOG: ModelEntry[] = [
  // Anthropic Claude
  {
    id: 'claude-opus-4-6',
    name: 'claude-opus-4-6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'thinking',
      'extended_thinking',
      'tool_use',
      'computer_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 15, outputPer1M: 75 },
  },
  {
    id: 'claude-opus-4-5',
    name: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'thinking',
      'extended_thinking',
      'tool_use',
      'computer_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 15, outputPer1M: 75 },
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'thinking',
      'extended_thinking',
      'tool_use',
      'computer_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 3, outputPer1M: 15 },
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'claude-sonnet-4-5-20251001',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'thinking',
      'extended_thinking',
      'tool_use',
      'computer_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 3, outputPer1M: 15 },
  },
  {
    id: 'claude-sonnet-4-0',
    name: 'claude-sonnet-4-0-20250501',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.0',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'thinking',
      'tool_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 3, outputPer1M: 15 },
  },
  {
    id: 'claude-sonnet-3-5',
    name: 'claude-sonnet-3-5-20241022',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 3.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 3, outputPer1M: 15 },
  },
  {
    id: 'claude-haiku-3-5',
    name: 'claude-haiku-3-5-20241022',
    provider: 'anthropic',
    displayName: 'Claude Haiku 3.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'context_caching',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 0.8, outputPer1M: 4 },
  },

  // OpenAI
  {
    id: 'gpt-4o',
    name: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
    ],
    pricing: { inputPer1M: 2.5, outputPer1M: 10 },
  },
  {
    id: 'gpt-4o-mini',
    name: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'structured_output',
      'parallel_tool_calls',
      'image_input',
    ],
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    displayName: 'o1',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'thinking',
      'tool_use',
    ],
    pricing: { inputPer1M: 15, outputPer1M: 60 },
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    displayName: 'o3 Mini',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: ['streaming', 'function_calling', 'thinking', 'tool_use'],
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
  },
  {
    id: 'gpt-4-turbo',
    name: 'gpt-4-turbo',
    provider: 'openai',
    displayName: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'image_input',
    ],
    pricing: { inputPer1M: 10, outputPer1M: 30 },
  },
  {
    id: 'gpt-4',
    name: 'gpt-4',
    provider: 'openai',
    displayName: 'GPT-4',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    pricing: { inputPer1M: 30, outputPer1M: 60 },
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    name: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek Chat',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'tool_use',
      'context_caching',
    ],
    pricing: { inputPer1M: 0.27, outputPer1M: 1.1 },
  },
  {
    id: 'deepseek-reasoner',
    name: 'deepseek-reasoner',
    provider: 'deepseek',
    displayName: 'DeepSeek Reasoner',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ['streaming', 'thinking', 'tool_use'],
    pricing: { inputPer1M: 0.55, outputPer1M: 2.19 },
  },

  // Google
  {
    id: 'gemini-2.5-pro',
    name: 'gemini-2.5-pro-exp-03-25',
    provider: 'google',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'structured_output',
      'code_execution',
      'image_input',
      'pdf_input',
    ],
    pricing: { inputPer1M: 1.25, outputPer1M: 10 },
  },
  {
    id: 'gemini-2.0-flash',
    name: 'gemini-2.0-flash',
    provider: 'google',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'structured_output',
      'image_input',
    ],
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
  },

  // OpenAI - 补充
  {
    id: 'o1-mini',
    name: 'o1-mini',
    provider: 'openai',
    displayName: 'o1 Mini',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    capabilities: ['streaming', 'function_calling', 'thinking', 'tool_use'],
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
  },
  {
    id: 'gpt-4.1-nano',
    name: 'gpt-4.1-nano',
    provider: 'openai',
    displayName: 'GPT-4.1 Nano',
    contextWindow: 1048576,
    maxOutputTokens: 32768,
    capabilities: [
      'streaming',
      'function_calling',
      'tool_use',
      'structured_output',
      'parallel_tool_calls',
    ],
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
  },

  // Google - 补充
  {
    id: 'gemini-1.5-pro',
    name: 'gemini-1.5-pro',
    provider: 'google',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2097152,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'code_execution',
      'image_input',
      'pdf_input',
      'context_caching',
    ],
    pricing: { inputPer1M: 1.25, outputPer1M: 5 },
  },
  {
    id: 'gemini-1.5-flash',
    name: 'gemini-1.5-flash',
    provider: 'google',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: [
      'streaming',
      'function_calling',
      'vision',
      'tool_use',
      'image_input',
      'context_caching',
    ],
    pricing: { inputPer1M: 0.075, outputPer1M: 0.3 },
  },

  // Ollama (开源本地)
  {
    id: 'ollama-llama3',
    name: 'llama3',
    provider: 'ollama',
    displayName: 'Llama 3',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    pricing: undefined,
  },
  {
    id: 'ollama-mistral',
    name: 'mistral',
    provider: 'ollama',
    displayName: 'Mistral',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: ['streaming'],
    pricing: undefined,
  },
];

export class ModelCatalog {
  private models: Map<string, ModelEntry> = new Map();

  constructor() {
    this.loadDefaults();
  }

  get(id: string): ModelEntry | undefined {
    const model = this.models.get(id);
    if (model) return model;

    for (const [, entry] of this.models) {
      if (entry.aliases?.includes(id)) return entry;
    }

    return undefined;
  }

  register(entry: ModelEntry): void {
    this.models.set(entry.id, entry);
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  list(filter?: {
    provider?: ModelProvider;
    capability?: ModelCapabilityFlag;
  }): ModelEntry[] {
    let result = Array.from(this.models.values());

    if (filter?.provider) {
      result = result.filter((m) => m.provider === filter.provider);
    }

    if (filter?.capability) {
      result = result.filter((m) =>
        m.capabilities.includes(filter.capability!)
      );
    }

    result = result.filter((m) => !m.deprecated);
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }

  getProviders(): ModelProvider[] {
    return Array.from(
      new Set(Array.from(this.models.values()).map((m) => m.provider))
    ).sort() as ModelProvider[];
  }

  getModelFamilies(): ModelFamily[] {
    const families = new Map<string, ModelEntry[]>();

    for (const model of this.models.values()) {
      const familyName = model.id.split('-').slice(0, 2).join('-');
      const existing = families.get(familyName) ?? [];
      existing.push(model);
      families.set(familyName, existing);
    }

    return Array.from(families.entries()).map(([name, models]) => ({
      name,
      provider: models[0].provider,
      description: `${models[0].displayName} family`,
      models: models.sort((a, b) => b.contextWindow - a.contextWindow),
    }));
  }

  findByCapability(capability: ModelCapabilityFlag): ModelEntry[] {
    return this.list({ capability });
  }

  findWithPricing(maxInputPricePer1M?: number): ModelEntry[] {
    let result = this.list();

    if (maxInputPricePer1M !== undefined) {
      result = result.filter(
        (m) => m.pricing && m.pricing.inputPer1M <= maxInputPricePer1M
      );
    }

    return result;
  }

  search(query: string): ModelEntry[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
    );
  }

  getCount(): number {
    return this.models.size;
  }

  getActiveCount(): number {
    return this.list().length;
  }

  reset(): void {
    this.models.clear();
    this.loadDefaults();
  }

  private loadDefaults(): void {
    for (const model of MODEL_CATALOG) {
      this.models.set(model.id, model);
    }
  }
}

export const defaultCatalog = new ModelCatalog();

export function createModelCatalog(): ModelCatalog {
  return new ModelCatalog();
}
