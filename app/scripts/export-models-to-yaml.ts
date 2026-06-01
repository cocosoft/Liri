/**
 * 模型数据迁移脚本
 * 生成 models.default.yaml
 * 完全自包含，不依赖任何模块
 *
 * 用法: bun run scripts/export-models-to-yaml.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { dump } from 'js-yaml';

interface ModelEntry {
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities?: string[];
  providers: Record<string, string>;
  pricing?: Record<string, number>;
  extendedContextWindows?: Array<{ suffix: string; windowSize: number }>;
}

const models: Record<string, ModelEntry> = {
  // ===== DeepSeek（主力） =====
  'deepseek-chat': {
    displayName: 'DeepSeek Chat', contextWindow: 128000, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'thinking', 'context_caching', 'structured_output', 'parallel_tool_calls'],
    providers: { firstParty: 'deepseek-chat', deepseek: 'deepseek-chat' },
    pricing: { inputPer1M: 0.5, outputPer1M: 2 },
  },
  'deepseek-reasoner': {
    displayName: 'DeepSeek Reasoner', contextWindow: 128000, maxOutputTokens: 8192,
    capabilities: ['streaming', 'thinking', 'tool_use'],
    providers: { firstParty: 'deepseek-reasoner', deepseek: 'deepseek-reasoner' },
    pricing: { inputPer1M: 0.55, outputPer1M: 2.19 },
  },
  'deepseek-v4-pro': {
    displayName: 'DeepSeek V4 Pro', contextWindow: 128000, maxOutputTokens: 16384,
    capabilities: ['streaming', 'function_calling', 'thinking', 'context_caching', 'structured_output'],
    providers: { firstParty: 'deepseek-v4-pro', deepseek: 'deepseek-v4-pro' },
    pricing: { inputPer1M: 1, outputPer1M: 4 },
  },
  'deepseek-v4-flash': {
    displayName: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'context_caching'],
    providers: { firstParty: 'deepseek-v4-flash', deepseek: 'deepseek-v4-flash' },
    pricing: { inputPer1M: 0.3, outputPer1M: 1.2 },
  },

  // ===== OpenAI GPT =====
  'gpt-4o': {
    displayName: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384,
    capabilities: ['streaming', 'function_calling', 'vision', 'tool_use', 'structured_output', 'image_input'],
    providers: { firstParty: 'gpt-4o', openai: 'gpt-4o' },
    pricing: { inputPer1M: 2.5, outputPer1M: 10, cacheReadPer1M: 1.25, cacheWritePer1M: 10 },
  },
  'gpt-4o-mini': {
    displayName: 'GPT-4o Mini', contextWindow: 128000, maxOutputTokens: 16384,
    capabilities: ['streaming', 'function_calling', 'vision', 'tool_use', 'structured_output', 'image_input'],
    providers: { firstParty: 'gpt-4o-mini', openai: 'gpt-4o-mini' },
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.075, cacheWritePer1M: 0.6 },
  },

  // ===== Google Gemini =====
  'gemini-2.5-pro': {
    displayName: 'Gemini 2.5 Pro', contextWindow: 1048576, maxOutputTokens: 65536,
    capabilities: ['streaming', 'function_calling', 'vision', 'tool_use', 'code_execution', 'image_input', 'audio_input', 'pdf_input', 'context_caching'],
    providers: { firstParty: 'gemini-2.5-pro', google: 'gemini-2.5-pro' },
    pricing: { inputPer1M: 1.25, outputPer1M: 10 },
  },
  'gemini-2.5-flash': {
    displayName: 'Gemini 2.5 Flash', contextWindow: 1048576, maxOutputTokens: 65536,
    capabilities: ['streaming', 'function_calling', 'vision', 'tool_use', 'code_execution', 'image_input', 'audio_input', 'pdf_input', 'context_caching'],
    providers: { firstParty: 'gemini-2.5-flash', google: 'gemini-2.5-flash' },
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
  },

  // ===== 阿里千问 Qwen =====
  'qwen-max': {
    displayName: 'Qwen Max', contextWindow: 131072, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'vision', 'tool_use', 'image_input'],
    providers: { firstParty: 'qwen-max', openai: 'qwen-max' },
    pricing: { inputPer1M: 2, outputPer1M: 6 },
  },
  'qwen-plus': {
    displayName: 'Qwen Plus', contextWindow: 131072, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'vision', 'tool_use', 'image_input'],
    providers: { firstParty: 'qwen-plus', openai: 'qwen-plus' },
    pricing: { inputPer1M: 0.8, outputPer1M: 2 },
  },
  'qwen-turbo': {
    displayName: 'Qwen Turbo', contextWindow: 131072, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    providers: { firstParty: 'qwen-turbo', openai: 'qwen-turbo' },
    pricing: { inputPer1M: 0.3, outputPer1M: 0.6 },
  },
  'qwen2.5-coder': {
    displayName: 'Qwen 2.5 Coder', contextWindow: 128000, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    providers: { firstParty: 'qwen2.5-coder', openai: 'qwen2.5-coder' },
    pricing: { inputPer1M: 0.5, outputPer1M: 1.5 },
  },

  // ===== Ollama 本地 =====
  'ollama-llama3': {
    displayName: 'Llama 3 (Ollama)', contextWindow: 8192, maxOutputTokens: 4096,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    providers: { firstParty: 'llama3', ollama: 'llama3' },
  },
  'ollama-deepseek': {
    displayName: 'DeepSeek (Ollama)', contextWindow: 16384, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    providers: { firstParty: 'deepseek-ollama', ollama: 'deepseek-ollama' },
  },
  'ollama-qwen': {
    displayName: 'Qwen (Ollama)', contextWindow: 16384, maxOutputTokens: 8192,
    capabilities: ['streaming', 'function_calling', 'tool_use'],
    providers: { firstParty: 'qwen-ollama', ollama: 'qwen-ollama' },
  },
};

const sortedModels: Record<string, ModelEntry> = {};
for (const key of Object.keys(models).sort()) {
  sortedModels[key] = models[key];
}

const output = {
  version: '1.0.0',
  description: 'Liri 内置默认模型配置 - DeepSeek 为主，轻量覆盖',
  models: sortedModels,
};

const yaml = dump(output, { lineWidth: 120, noRefs: true, sortKeys: true });
const outPath = join(import.meta.dirname, '..', 'src/ai/config/models.default.yaml');
writeFileSync(outPath, yaml, 'utf-8');
console.log(`已导出 ${Object.keys(output.models).length} 个模型到 ${outPath}`);
