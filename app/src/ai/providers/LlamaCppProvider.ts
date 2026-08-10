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
 * LlamaCppProvider — llama.cpp (Local) 推理供应商
 *
 * llama.cpp server 提供 OpenAI 兼容 /v1/chat/completions，故继承 OpenAIProvider
 * 复用 ChatCompletionsTransport 与完整 OpenAI 兼容实现；仅覆盖本地特有语义：
 *  - 可用性探测走 /health（而非 OpenAI /models 鉴权）
 *  - 模型列表优先返回本地 GGUF 文件（ServerManager.scanModels）
 *  - 本地服务无需 API Key（validateConfig 不要求）
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { OpenAIProvider } from './OpenAIProvider';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';

const logger = new Logger({ module: 'ai:llama', level: LogLevel.INFO });

/** llama-server 默认 OpenAI 兼容端点（与 LlamaCppServerManager 默认端口对齐） */
const DEFAULT_BASE_URL = 'http://127.0.0.1:11435/v1';

export class LlamaCppProvider extends OpenAIProvider {
  /**
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl 等）
   * @param _extraConfig - 扩展配置（保留接口一致）
   */
  constructor(
    options: import('./BaseAIProvider').BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);
    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ''
    );
  }

  /** 本地服务可用性：探测 llama-server /health */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * 模型列表：优先 GGUF 目录扫描（本地文件为准），
   * 其次 llama-server /models（OpenAI 兼容）兜底
   */
  override async listModels(): Promise<string[]> {
    const { llamaCppServerManager } =
      await import('../local/llama/LlamaCppServerManager.js');
    const ggufModels = llamaCppServerManager
      .scanModels()
      .map((p) => p.split(/[\\/]/).pop() || p);
    if (ggufModels.length > 0) return ggufModels;

    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { id: string }[] };
      return (data.data || []).map((m) => m.id);
    } catch (err) {
      logger.debug('llama-server /models 查询失败，返回空列表', {
        error: String(err),
      });
      return [];
    }
  }

  /** 本地服务无需 API Key；仅校验 baseUrl 可达性 */
  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const warnings: string[] = [];
    if (!config.baseUrl) {
      warnings.push(
        'No baseUrl configured, using default: ' + DEFAULT_BASE_URL
      );
    }
    return { valid: true, errors: [], warnings };
  }
}
