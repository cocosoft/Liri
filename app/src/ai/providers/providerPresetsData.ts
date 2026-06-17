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
 * Provider 预设数据
 *
 * 服务端预设数据，通过 /v1/providers/presets 提供给前端。
 * 保持与 client/src/config/providerPresets.ts 同步。
 */

export interface ProviderPresetTheme {
  icon: string;
  backgroundColor: string;
  textColor: string;
}

export interface ProviderPresetSettings {
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  modelsUrl: string;
  notes: string;
  requiresAuth: boolean;
  category: string;
}

export interface ProviderPreset {
  name: string;
  websiteUrl?: string;
  apiKeyUrl?: string;
  settingsConfig: ProviderPresetSettings;
  isOfficial: boolean;
  category: string;
  apiFormat: string;
  providerType: string;
  requiresOAuth: boolean;
  modelsUrl?: string;
  endpointCandidates?: string[];
  theme?: ProviderPresetTheme;
}

export const PRESETS: ProviderPreset[] = [
  // ═══════════════════════ Official ═══════════════════════
  {
    name: 'OpenAI',
    websiteUrl: 'https://platform.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    isOfficial: true,
    category: 'official',
    apiFormat: 'openai',
    providerType: 'openai',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.openai.com/v1'],
    settingsConfig: {
      name: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'official',
    },
    theme: { icon: 'openai', backgroundColor: '#10a37f', textColor: '#ffffff' },
  },
  {
    name: 'Anthropic',
    websiteUrl: 'https://console.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    isOfficial: true,
    category: 'official',
    apiFormat: 'anthropic',
    providerType: 'anthropic',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.anthropic.com'],
    settingsConfig: {
      name: 'Anthropic',
      providerType: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'official',
    },
    theme: {
      icon: 'anthropic',
      backgroundColor: '#d97757',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Google Gemini',
    websiteUrl: 'https://ai.google.dev',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    isOfficial: true,
    category: 'official',
    apiFormat: 'google',
    providerType: 'google',
    requiresOAuth: false,
    modelsUrl: '/v1beta/models',
    endpointCandidates: [
      'https://generativelanguage.googleapis.com/v1beta',
      'https://generativelanguage.googleapis.com/v1',
    ],
    settingsConfig: {
      name: 'Google Gemini',
      providerType: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'official',
    },
    theme: { icon: 'google', backgroundColor: '#4285f4', textColor: '#ffffff' },
  },
  {
    name: 'DeepSeek',
    websiteUrl: 'https://platform.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    isOfficial: true,
    category: 'official',
    apiFormat: 'openai',
    providerType: 'deepseek',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.deepseek.com'],
    settingsConfig: {
      name: 'DeepSeek',
      providerType: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'official',
    },
    theme: {
      icon: 'deepseek',
      backgroundColor: '#4f6ef7',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Grok',
    websiteUrl: 'https://console.x.ai',
    apiKeyUrl: 'https://console.x.ai',
    isOfficial: true,
    category: 'official',
    apiFormat: 'openai',
    providerType: 'grok',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.x.ai/v1'],
    settingsConfig: {
      name: 'Grok',
      providerType: 'grok',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'official',
    },
    theme: { icon: 'grok', backgroundColor: '#14171a', textColor: '#ffffff' },
  },

  // ═══════════════════════ Aggregator ═══════════════════════
  {
    name: 'OpenRouter',
    websiteUrl: 'https://openrouter.ai',
    apiKeyUrl: 'https://openrouter.ai/keys',
    isOfficial: false,
    category: 'aggregator',
    apiFormat: 'openai',
    providerType: 'openrouter',
    requiresOAuth: false,
    modelsUrl: '/api/v1/models',
    endpointCandidates: ['https://openrouter.ai/api/v1'],
    settingsConfig: {
      name: 'OpenRouter',
      providerType: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '聚合多家供应商，支持模型路由',
      requiresAuth: true,
      category: 'aggregator',
    },
    theme: {
      icon: 'openrouter',
      backgroundColor: '#7b3fe4',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Together AI',
    websiteUrl: 'https://www.together.ai',
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    isOfficial: false,
    category: 'aggregator',
    apiFormat: 'openai',
    providerType: 'together',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.together.xyz/v1'],
    settingsConfig: {
      name: 'Together AI',
      providerType: 'together',
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '开源模型聚合推理',
      requiresAuth: true,
      category: 'aggregator',
    },
    theme: {
      icon: 'together',
      backgroundColor: '#6366f1',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Fireworks AI',
    websiteUrl: 'https://fireworks.ai',
    apiKeyUrl: 'https://fireworks.ai/api-keys',
    isOfficial: false,
    category: 'aggregator',
    apiFormat: 'openai',
    providerType: 'fireworks',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.fireworks.ai/inference/v1'],
    settingsConfig: {
      name: 'Fireworks AI',
      providerType: 'fireworks',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '快速开源模型推理',
      requiresAuth: true,
      category: 'aggregator',
    },
    theme: {
      icon: 'fireworks',
      backgroundColor: '#f97316',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Groq',
    websiteUrl: 'https://groq.com',
    apiKeyUrl: 'https://console.groq.com/keys',
    isOfficial: false,
    category: 'aggregator',
    apiFormat: 'openai',
    providerType: 'groq',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.groq.com/openai/v1'],
    settingsConfig: {
      name: 'Groq',
      providerType: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '极速 LPU 推理引擎',
      requiresAuth: true,
      category: 'aggregator',
    },
    theme: { icon: 'groq', backgroundColor: '#38bd8a', textColor: '#ffffff' },
  },

  // ═══════════════════════ Third Party ═══════════════════════
  {
    name: 'Mistral AI',
    websiteUrl: 'https://console.mistral.ai',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    isOfficial: false,
    category: 'third_party',
    apiFormat: 'openai',
    providerType: 'custom',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.mistral.ai/v1'],
    settingsConfig: {
      name: 'Mistral AI',
      providerType: 'custom',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'third_party',
    },
    theme: {
      icon: 'mistral',
      backgroundColor: '#fca5a5',
      textColor: '#1a1a2e',
    },
  },
  {
    name: 'Perplexity',
    websiteUrl: 'https://www.perplexity.ai',
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    isOfficial: false,
    category: 'third_party',
    apiFormat: 'openai',
    providerType: 'custom',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.perplexity.ai'],
    settingsConfig: {
      name: 'Perplexity',
      providerType: 'custom',
      baseUrl: 'https://api.perplexity.ai',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'third_party',
    },
    theme: {
      icon: 'perplexity',
      backgroundColor: '#1d4ed8',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Cohere',
    websiteUrl: 'https://dashboard.cohere.com',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    isOfficial: false,
    category: 'third_party',
    apiFormat: 'custom',
    providerType: 'custom',
    requiresOAuth: false,
    settingsConfig: {
      name: 'Cohere',
      providerType: 'custom',
      baseUrl: 'https://api.cohere.com',
      apiKey: '',
      modelsUrl: '',
      notes: '',
      requiresAuth: true,
      category: 'third_party',
    },
    theme: { icon: 'cohere', backgroundColor: '#d97706', textColor: '#ffffff' },
  },

  // ═══════════════════════ CN Official ═══════════════════════
  {
    name: 'SiliconFlow',
    websiteUrl: 'https://siliconflow.cn',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    isOfficial: true,
    category: 'cn_official',
    apiFormat: 'openai',
    providerType: 'siliconflow',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.siliconflow.cn/v1'],
    settingsConfig: {
      name: 'SiliconFlow',
      providerType: 'siliconflow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '国内模型聚合平台',
      requiresAuth: true,
      category: 'cn_official',
    },
    theme: {
      icon: 'siliconflow',
      backgroundColor: '#0ea5e9',
      textColor: '#ffffff',
    },
  },
  {
    name: '智谱AI (GLM)',
    websiteUrl: 'https://open.bigmodel.cn',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    isOfficial: true,
    category: 'cn_official',
    apiFormat: 'openai',
    providerType: 'zhipu',
    requiresOAuth: false,
    modelsUrl: '/api/paas/v4/models',
    endpointCandidates: ['https://open.bigmodel.cn/api/paas/v4'],
    settingsConfig: {
      name: '智谱AI',
      providerType: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      modelsUrl: '',
      notes: '智谱 GLM 系列',
      requiresAuth: true,
      category: 'cn_official',
    },
    theme: { icon: 'zhipu', backgroundColor: '#2563eb', textColor: '#ffffff' },
  },
  {
    name: '阿里通义千问',
    websiteUrl: 'https://dashscope.aliyun.com',
    apiKeyUrl: 'https://dashscope.aliyun.com/apiKey',
    isOfficial: true,
    category: 'cn_official',
    apiFormat: 'openai',
    providerType: 'qwen',
    requiresOAuth: false,
    modelsUrl: '/compatible-mode/v1/models',
    endpointCandidates: ['https://dashscope.aliyuncs.com/compatible-mode/v1'],
    settingsConfig: {
      name: '阿里通义千问',
      providerType: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '通义千问系列',
      requiresAuth: true,
      category: 'cn_official',
    },
    theme: { icon: 'qwen', backgroundColor: '#ff6a00', textColor: '#ffffff' },
  },
  {
    name: '百度千帆',
    websiteUrl: 'https://console.bce.baidu.com/qianfan',
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/application',
    isOfficial: true,
    category: 'cn_official',
    apiFormat: 'openai',
    providerType: 'qianfan',
    requiresOAuth: false,
    endpointCandidates: ['https://qianfan.baidubce.com/v2'],
    settingsConfig: {
      name: '百度千帆',
      providerType: 'qianfan',
      baseUrl: 'https://qianfan.baidubce.com/v2',
      apiKey: '',
      modelsUrl: '',
      notes: '文心系列，需 IAM 鉴权',
      requiresAuth: true,
      category: 'cn_official',
    },
    theme: {
      icon: 'qianfan',
      backgroundColor: '#2932e1',
      textColor: '#ffffff',
    },
  },
  {
    name: 'Moonshot (月之暗面)',
    websiteUrl: 'https://platform.moonshot.cn',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    isOfficial: true,
    category: 'cn_official',
    apiFormat: 'openai',
    providerType: 'moonshot',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: ['https://api.moonshot.cn/v1'],
    settingsConfig: {
      name: 'Moonshot',
      providerType: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: '',
      modelsUrl: '',
      notes: 'Kimi 系列模型',
      requiresAuth: true,
      category: 'cn_official',
    },
    theme: {
      icon: 'moonshot',
      backgroundColor: '#8b5cf6',
      textColor: '#ffffff',
    },
  },

  // ═══════════════════════ Local ═══════════════════════
  {
    name: 'Ollama',
    websiteUrl: 'https://ollama.ai',
    isOfficial: true,
    category: 'third_party',
    apiFormat: 'openai',
    providerType: 'ollama',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: [
      'http://localhost:11434/v1',
      'http://127.0.0.1:11434/v1',
    ],
    settingsConfig: {
      name: 'Ollama',
      providerType: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '本地运行，无需 API Key',
      requiresAuth: false,
      category: 'third_party',
    },
    theme: { icon: 'ollama', backgroundColor: '#6d28d9', textColor: '#ffffff' },
  },
  {
    name: 'LM Studio',
    websiteUrl: 'https://lmstudio.ai',
    isOfficial: true,
    category: 'third_party',
    apiFormat: 'openai',
    providerType: 'custom',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: [
      'http://localhost:1234/v1',
      'http://127.0.0.1:1234/v1',
    ],
    settingsConfig: {
      name: 'LM Studio',
      providerType: 'custom',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '本地运行，无需 API Key',
      requiresAuth: false,
      category: 'third_party',
    },
    theme: {
      icon: 'lmstudio',
      backgroundColor: '#e11d48',
      textColor: '#ffffff',
    },
  },
  {
    name: 'LocalAI',
    websiteUrl: 'https://localai.io',
    isOfficial: true,
    category: 'third_party',
    apiFormat: 'openai',
    providerType: 'custom',
    requiresOAuth: false,
    modelsUrl: '/v1/models',
    endpointCandidates: [
      'http://localhost:8080/v1',
      'http://127.0.0.1:8080/v1',
    ],
    settingsConfig: {
      name: 'LocalAI',
      providerType: 'custom',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: '',
      modelsUrl: '',
      notes: '本地运行，无需 API Key',
      requiresAuth: false,
      category: 'third_party',
    },
    theme: {
      icon: 'localai',
      backgroundColor: '#0891b2',
      textColor: '#ffffff',
    },
  },
];

/** 按分类分组 */
export function getPresetsByCategory(): Record<string, ProviderPreset[]> {
  const grouped: Record<string, ProviderPreset[]> = {};
  for (const preset of PRESETS) {
    const cat = preset.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(preset);
  }
  return grouped;
}
