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
import type { MigrateProgress } from '@modules/ai';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { resolveLlamaModelsDir } from '@modules/core/paths';
import { sendError, readRequestBody } from './handler-utils';

const logger = getLogger('http:llama');

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
        modelsDir: parsed.modelsDir as string | undefined,
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

/**
 * POST /v1/llama/force-kill — 强制杀掉所有 llama-server 进程
 * 用于服务卡死无响应时的紧急恢复手段
 */
export async function handleLlamaForceKill(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    const result = await llamaCppServerManager.forceKill();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: true,
        remainingProcesses: result.killed,
        message:
          result.killed > 0
            ? `已杀掉 ${result.killed} 个 llama-server 进程`
            : '未检测到 llama-server 进程',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'forceKill',
    });
    sendError(res, err);
  }
}

/**
 * POST /v1/llama/force-restart — 强制杀掉并重启 llama-server
 * 一键恢复卡死的服务
 */
export async function handleLlamaForceRestart(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    await llamaCppServerManager.forceKillAndRestart();
    const status = await llamaCppServerManager.getStatus();

    if (status.status === 'error' || !status.running) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          error: status.lastError || '强制重启后服务未就绪',
        })
      );
      return;
    }

    const { ensureLlamaCppProviderRegistered } =
      await import('@modules/ai/local/llama/registerLlamaCppProvider.js');
    const providerRegistered = await ensureLlamaCppProviderRegistered();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: true,
        providerRegistered,
        status: status.status,
        message: 'llama-server 已强制重启',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'forceRestart',
    });
    sendError(res, err);
  }
}

/**
 * GET /v1/llama/logs — 获取 llama-server 日志
 */
export async function handleLlamaLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const maxLines = parseInt(url.searchParams.get('lines') || '200', 10);
    const logs = llamaCppServerManager.getLogContent(maxLines);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, logs }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'getLogs',
    });
    sendError(res, err);
  }
}

/**
 * GET /v1/llama/logs/stream — 实时流式推送 llama-server 日志（SSE）
 * 客户端可以实时接收到新增的日志内容
 */
export async function handleLlamaLogsStream(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const { llamaCppServerManager } =
    await import('@modules/ai/local/llama/LlamaCppServerManager.js');

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 发送初始日志内容
  const url = new URL(req.url ?? '/', 'http://localhost');
  const initialLines = parseInt(
    url.searchParams.get('initialLines') || '100',
    10
  );
  const initialLogs = llamaCppServerManager.getLogContent(initialLines);
  if (initialLogs) {
    res.write(
      `event: initial\ndata: ${JSON.stringify({ logs: initialLogs })}\n\n`
    );
  }

  // 订阅日志实时更新
  const unsubscribe = llamaCppServerManager.subscribeLogs(
    (newContent: string) => {
      res.write(
        `event: log\ndata: ${JSON.stringify({ logs: newContent })}\n\n`
      );
    }
  );

  // 客户端断开连接时清理
  req.on('close', () => {
    unsubscribe();
    res.end();
  });

  req.on('error', () => {
    unsubscribe();
    res.end();
  });

  // 保持连接，每30秒发送心跳
  const heartbeat = setInterval(() => {
    try {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      res.write(`event: ping\ndata: {}\n\n`);
    } catch (heartbeatErr) {
      // KB-R08-HEARTBEAT（2026-08-29）：SSE 心跳写入异常（连接已断）——终止心跳并记录
      clearInterval(heartbeat);
      logger.warn('SSE 心跳写入失败，终止心跳', {
        error:
          heartbeatErr instanceof Error
            ? heartbeatErr.message
            : String(heartbeatErr),
      });
    }
  }, 30000);
}

// ============================================================
// 模型迁移 API（Task 2.2）
// ============================================================

/** 迁移请求 */
interface LlamaMigrateRequest {
  targetDir: string;
  copy?: boolean;
  overwrite?: boolean;
}

/** 存储迁移控制器（用于取消） */
const migrateControllers = new Map<string, AbortController>();

/**
 * POST /v1/llama/migrate — 迁移模型文件（SSE 推送进度）
 */
export async function handleLlamaMigrate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let controller: AbortController | null = null;

  try {
    const { llamaCppServerManager, ensureSafeMigrationPath } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');

    const body = await readRequestBody(req);
    const parsed = JSON.parse(body || '{}') as LlamaMigrateRequest;

    // 1. 参数校验
    if (!parsed.targetDir) {
      throw new AppError(
        '目标目录不能为空',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MIGRATE_TARGET_EMPTY'
      );
    }

    // 2. 安全检查
    const sourceDir = llamaCppServerManager.getConfig().modelsDir
      ? resolveLlamaModelsDir(llamaCppServerManager.getConfig().modelsDir)
      : resolveLlamaModelsDir();
    const safetyCheck = ensureSafeMigrationPath(parsed.targetDir, sourceDir);

    if (!safetyCheck.valid || !safetyCheck.safePath) {
      throw new AppError(
        safetyCheck.errors.join('; '),
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'MIGRATE_PATH_UNSAFE'
      );
    }

    // 3. 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 4. 创建 AbortController 支持取消
    controller = new AbortController();
    migrateControllers.set('default', controller);

    // 5. 执行迁移（带进度回调）
    const result = await llamaCppServerManager.migrateModels({
      targetDir: safetyCheck.safePath,
      copy: parsed.copy ?? false,
      overwrite: parsed.overwrite ?? false,
      onProgress: (progress: MigrateProgress) => {
        // SSE 推送进度
        res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
      },
      signal: controller.signal,
    });

    // 6. 更新配置（仅在非取消且成功时）
    if (result.success && !controller.signal.aborted) {
      await llamaCppServerManager.updateConfig({
        modelsDir: safetyCheck.safePath,
      });
    }

    // 7. 推送最终结果
    if (controller.signal.aborted) {
      res.write(
        `event: cancelled\ndata: ${JSON.stringify({
          success: true,
          message: '迁移已取消',
        })}\n\n`
      );
    } else {
      res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
    }

    res.end();
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'migrate',
    });

    // SSE 错误推送
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    }
    const errorResponse = { success: false, error: String(err) };
    res.write(`event: error\ndata: ${JSON.stringify(errorResponse)}\n\n`);
    res.end();
  } finally {
    if (controller) {
      migrateControllers.delete('default');
    }
  }
}

/**
 * POST /v1/llama/migrate/cancel — 取消正在进行的迁移
 */
export async function handleLlamaMigrateCancel(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const controller = migrateControllers.get('default');
  if (controller) {
    controller.abort();
    migrateControllers.delete('default');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: '迁移已取消' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, message: '没有正在进行的迁移' }));
  }
}

/**
 * DELETE /v1/llama/models/:filename — 删除指定模型
 */
export async function handleLlamaDeleteModel(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    const { unlinkSync, existsSync } = await import('fs');
    const { basename, join } = await import('path');

    const fileName = (req.url || '').split('/').pop();
    if (!fileName) {
      throw new AppError(
        '模型文件名不能为空',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODEL_FILENAME_EMPTY'
      );
    }

    // 安全检查：只允许删除 GGUF 文件
    if (!fileName.toLowerCase().endsWith('.gguf')) {
      throw new AppError(
        '只允许删除 .gguf 文件',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'MODEL_DELETE_FORBIDDEN'
      );
    }

    // 获取模型目录
    const config = llamaCppServerManager.getConfig();
    const modelsDir = config.modelsDir
      ? resolveLlamaModelsDir(config.modelsDir)
      : resolveLlamaModelsDir();
    const modelPath = join(modelsDir, fileName);

    if (!existsSync(modelPath)) {
      throw new AppError(
        `模型文件不存在: ${fileName}`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        'MODEL_NOT_FOUND'
      );
    }

    // 检查是否为当前使用的模型
    if (config.model === modelPath) {
      throw new AppError(
        '不能删除当前正在使用的模型，请先停止服务或更换模型',
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH,
        'MODEL_IN_USE'
      );
    }

    // 删除文件
    unlinkSync(modelPath);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: true,
        deleted: fileName,
        message: `模型 ${fileName} 已删除`,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'deleteModel',
    });
    sendError(res, err);
  }
}

/**
 * GET /v1/llama/hardware — 获取硬件检测结果
 */
export async function handleLlamaHardware(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { HardwareDetector } =
      await import('@modules/ai/local/llama/HardwareDetector.js');
    const detector = new HardwareDetector();

    const url = new URL(req.url ?? '/', 'http://localhost');
    const forceRefresh = url.searchParams.get('forceRefresh') === '1';
    const hardware = await detector.detect({ forceRefresh });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, hardware }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'hardwareDetection',
    });
    sendError(res, err);
  }
}

/**
 * GET /v1/llama/recommendations — 获取模型推荐列表
 */
export async function handleLlamaRecommendations(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { HardwareDetector } =
      await import('@modules/ai/local/llama/HardwareDetector.js');
    const { ModelRecommender } =
      await import('@modules/ai/local/llama/ModelRecommender.js');

    const detector = new HardwareDetector();
    const hardware = await detector.detect();
    const recommender = new ModelRecommender();
    const recommendations = await recommender.recommend(hardware, detector);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, recommendations }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'getRecommendations',
    });
    sendError(res, err);
  }
}

/**
 * POST /v1/llama/download — 下载模型（SSE 推送进度）
 */
export async function handleLlamaDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { ModelDownloadService } =
      await import('@modules/ai/local/llama/ModelDownloadService.js');
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body || '{}');

    const service = new ModelDownloadService();

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const result = await service.downloadAndConfigure(
      {
        modelId: parsed.modelId as string,
        quantVersion: parsed.quantVersion as string,
        fileSizeGB: parsed.fileSizeGB as number,
        qualityScore: parsed.qualityScore as number,
        suitability: parsed.suitability as 'high' | 'medium' | 'low',
        estimatedRamGB: parsed.estimatedRamGB as number,
        recommendationReason: parsed.recommendationReason as string,
      },
      {
        autoStart: parsed.autoStart as boolean | undefined,
        onProgress: (p) => {
          const percent =
            p.totalMB > 0
              ? Math.min(99, Math.round((p.downloadedMB / p.totalMB) * 100))
              : 0;
          res.write(
            `event: progress\ndata: ${JSON.stringify({
              percent,
              status: '下载中',
              downloadedMB: p.downloadedMB,
              totalMB: p.totalMB,
              speedMBs: p.speedMBs,
            })}\n\n`
          );
        },
      }
    );

    // 推送最终结果
    res.write(
      `event: complete\ndata: ${JSON.stringify({ success: true, ...result })}\n\n`
    );
    res.end();
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'downloadModel',
    });

    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    }
    const errorResponse = { success: false, error: String(err) };
    res.write(`event: error\ndata: ${JSON.stringify(errorResponse)}\n\n`);
    res.end();
  }
}
