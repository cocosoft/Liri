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
 * ProviderFactory — providerType → AIProvider
 *
 * 唯一职责：把 providerType 字符串映射到正确的 Provider 类。
 * 不做数据配置 —— baseUrl / apiKey / displayName 一概由 DB 或调用方 config 提供。
 *
 * 规则：
 *   OpenAI 兼容协议 → OpenAIProvider（占绝大多数）
 *   独特协议        → 专用 Provider 类
 */

import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GoogleProvider } from './GoogleProvider';
import { OllamaProvider } from './OllamaProvider';
import { LlamaCppProvider } from './LlamaCppProvider';
import { BedrockProvider } from './BedrockProvider';
import { VertexAIProvider } from './VertexAIProvider';
import { AzureOpenAIProvider } from './AzureOpenAIProvider';
import { FALProvider } from './FALProvider';
import { StabilityProvider } from './StabilityProvider';
import { ReplicateProvider } from './ReplicateProvider';
import { ViduProvider } from './ViduProvider';
import { MiniMaxVideoProvider } from './MiniMaxVideoProvider';
import { KlingProvider } from './KlingProvider';
import { VolcengineProvider } from './VolcengineProvider';
import { DashScopeVideoProvider } from './DashScopeVideoProvider';
import type { AIProvider, ProviderConfig } from './AIProvider';
import type { ProviderType } from './ProviderManager';

/** ComfyUI 延迟 require（避免静态 import 导致启动时加载 Electron/CORS 模块） */
function createComfyProvider(config: ProviderConfig): AIProvider {
  const { ComfyUIProvider } =
    require('./ComfyUIProvider') as typeof import('./ComfyUIProvider');
  return new ComfyUIProvider({
    providerId: 'comfy',
    displayName: 'ComfyUI (本地)',
    defaultBaseUrl: config?.baseUrl as string | undefined,
  });
}

export function createProviderByType(
  type: ProviderType | string,
  config: ProviderConfig
): AIProvider {
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider({
        providerId: 'anthropic',
        displayName: 'Anthropic Claude',
        envApiKey: 'ANTHROPIC_API_KEY',
      });
    case 'google':
      return new GoogleProvider({
        providerId: 'google',
        displayName: 'Google Gemini',
        envApiKey: 'GOOGLE_API_KEY',
      });
    case 'ollama':
      return new OllamaProvider({
        providerId: 'ollama',
        displayName: 'Ollama (Local)',
      });
    case 'llamacpp':
      return new LlamaCppProvider({
        providerId: 'llamacpp',
        displayName: 'llama.cpp (Local)',
        defaultBaseUrl: config?.baseUrl as string | undefined,
      });
    case 'bedrock':
      return new BedrockProvider(
        { providerId: 'bedrock', displayName: 'AWS Bedrock' },
        config
      );
    case 'vertex':
      return new VertexAIProvider(
        { providerId: 'vertex-ai', displayName: 'Google Vertex AI' },
        config
      );
    case 'azure':
      return new AzureOpenAIProvider(
        { providerId: 'azure-openai', displayName: 'Azure OpenAI' },
        config
      );
    case 'fal':
      return new FALProvider({
        providerId: 'fal',
        displayName: 'FAL.ai',
        envApiKey: 'FAL_API_KEY',
      });
    case 'stability':
      return new StabilityProvider({
        providerId: 'stability',
        displayName: 'Stability AI',
        envApiKey: 'STABILITY_API_KEY',
      });
    case 'replicate':
      return new ReplicateProvider({
        providerId: 'replicate',
        displayName: 'Replicate',
        envApiKey: 'REPLICATE_API_TOKEN',
      });
    case 'vidu':
      return new ViduProvider();
    case 'minimax':
      return new MiniMaxVideoProvider();
    case 'kling':
      return new KlingProvider();
    case 'volcengine':
      return new VolcengineProvider();
    case 'dashscope':
      return new DashScopeVideoProvider();
    case 'comfy':
      return createComfyProvider(config);
    default:
      // 所有未列出的 providerType 一律作 OpenAI 兼容协议处理
      return new OpenAIProvider({
        providerId: type,
        displayName: type,
        envApiKey: undefined,
        defaultBaseUrl: config?.baseUrl as string | undefined,
      });
  }
}
