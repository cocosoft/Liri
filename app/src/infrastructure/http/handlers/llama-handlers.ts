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
 * llama-handlers.ts — llama.cpp 集成 REST API handler（Phase 1：状态查询）
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { sendError, readRequestBody } from './handler-utils';

/**
 * GET /v1/llama/status — 查询 llama.cpp 集成状态
 * 返回：二进制版本/存在性、服务运行状态、端口、已配置模型、GGUF 模型列表
 */
export async function handleLlamaStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    const status = await llamaCppServerManager.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, status }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'getStatus',
    });
    sendError(res, err);
  }
}

/**
 * GET /v1/llama/config — 查询 llama.cpp 专业配置
 * PUT /v1/llama/config — 保存配置（校验 + 持久化 config.json llama 段）
 */
export async function handleLlamaConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const method = req.method || 'GET';
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    if (method === 'GET') {
      const status = await llamaCppServerManager.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: true,
          config: llamaCppServerManager.getConfig(),
          status,
        })
      );
      return;
    }

    if (method === 'PUT') {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
      const config = await llamaCppServerManager.updateConfig({
        host: parsed.host as string | undefined,
        port: parsed.port as number | undefined,
        model: parsed.model as string | undefined,
        gpuLayers: parsed.gpuLayers as number | undefined,
        contextWindow: parsed.contextWindow as number | undefined,
        autoStart: parsed.autoStart as boolean | undefined,
        kvCache: parsed.kvCache as 'low' | 'medium' | 'high' | undefined,
        threads: parsed.threads as number | undefined,
        batchSize: parsed.batchSize as number | undefined,
        temperature: parsed.temperature as number | undefined,
        topK: parsed.topK as number | undefined,
        topP: parsed.topP as number | undefined,
        repeatPenalty: parsed.repeatPenalty as number | undefined,
        seed: parsed.seed as number | undefined,
        noMmap: parsed.noMmap as boolean | undefined,
        mlock: parsed.mlock as boolean | undefined,
        flashAttn: parsed.flashAttn as 'off' | 'on' | 'auto' | undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, config }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'updateConfig',
    });
    sendError(res, err);
  }
}

/**
 * POST /v1/llama/restart — 应用配置并重启 llama-server
 * 重启就绪后同步注册 llamacpp provider（配置页「保存并重启」路径；
 * 冷启动链仅覆盖应用启动时就绪的场景）
 */
export async function handleLlamaRestart(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    await llamaCppServerManager.restart();
    const status = await llamaCppServerManager.getStatus();
    if (status.status === 'error' || !status.running) {
      // 重启后未就绪（如未配置 GGUF 模型）：返回错误而非静默 success:true
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          error: status.lastError || 'llama-server 重启后未就绪',
        })
      );
      return;
    }
    const { ensureLlamaCppProviderRegistered } =
      await import('@modules/ai/local/llama/registerLlamaCppProvider.js');
    const providerRegistered = await ensureLlamaCppProviderRegistered();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, providerRegistered }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'restart',
    });
    sendError(res, err);
  }
}
