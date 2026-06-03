/**
 * Provider 快速预置
 * 用于"快速添加"功能的下拉选单
 */

import type { ProviderFormData } from "../types";

export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  ollama: "Ollama (本地)",
  moonshot: "Moonshot",
  grok: "Grok",
  bedrock: "AWS Bedrock",
  vertex: "Google Vertex AI",
  azure: "Azure OpenAI",
  custom: "自定义",
};

export const QUICK_PRESETS: Array<{ name: string; form: ProviderFormData }> = [
  {
    name: "DeepSeek",
    form: {
      name: "DeepSeek",
      providerType: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      modelsUrl: "",
      notes: "",
      requiresAuth: true,
    },
  },
  {
    name: "OpenAI",
    form: {
      name: "OpenAI",
      providerType: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      modelsUrl: "",
      notes: "",
      requiresAuth: true,
    },
  },
  {
    name: "Anthropic",
    form: {
      name: "Anthropic",
      providerType: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      modelsUrl: "",
      notes: "",
      requiresAuth: true,
    },
  },
  {
    name: "Google Gemini",
    form: {
      name: "Google Gemini",
      providerType: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "",
      modelsUrl: "",
      notes: "",
      requiresAuth: true,
    },
  },
  {
    name: "Ollama (本地)",
    form: {
      name: "Ollama",
      providerType: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      modelsUrl: "",
      notes: "本地运行，无需 API Key",
      requiresAuth: false,
    },
  },
  {
    name: "SiliconFlow",
    form: {
      name: "SiliconFlow",
      providerType: "custom",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "",
      modelsUrl: "",
      notes: "",
      requiresAuth: true,
    },
  },
];
