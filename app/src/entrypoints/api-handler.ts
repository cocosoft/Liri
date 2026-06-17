/**
 * API 处理器入口（内联实现 + 可选真实处理器桥接）
 *
 * 提供前端客户端需要的 HTTP API 路由。
 * 默认使用内联实现（仅使用 Bun/Node 原生 API，无 @modules/* 导入），
 * 后台异步尝试加载真实处理器（LocalHTTPService），加载成功后自动切换。
 *
 * 内联实现覆盖以下路由：
 *   GET /v1/models
 *   GET /v1/models/current
 *   GET /v1/monitor/summary
 *   GET /v1/events          （SSE 事件流）
 *   GET /api/cost/summary
 *   GET /api/cost/records
 *   GET /health, GET /api/health
 */

import os from 'node:os';

export type APIHandler = (req: Request) => Promise<Response>;

/**
 * 创建 API 处理器
 *
 * 返回的处理器始终优先使用内联实现。
 * 真实处理器（LocalHTTPService）在后台异步加载，
 * 加载成功后设置到 shared 引用中供后续请求使用。
 */
export function createAPIHandler(): APIHandler {
  // 共享引用：内联 → 真实处理器的切换点
  const shared = {
    realHandler: null as ((req: Request) => Promise<Response>) | null,
  };

  // 后台异步加载真实处理器（不阻塞当前请求）
  tryInitRealHandler(shared);

  return async (req: Request): Promise<Response> => {
    // 如果真实处理器已就绪，使用它
    if (shared.realHandler) {
      try {
        return await shared.realHandler(req);
      } catch {
        // 真实处理器失败，走内联路径
      }
    }

    // 内联路由处理
    const url = new URL(req.url);
    const pathname = url.pathname;

    try {
      return await handleRoute(req, pathname);
    } catch (err) {
      return jsonResponse(
        { error: 'Internal Server Error', message: String(err) },
        500
      );
    }
  };
}

// ================================================================
// 路由分发
// ================================================================

async function handleRoute(req: Request, pathname: string): Promise<Response> {
  // 根路径
  if (pathname === '/') {
    return healthResponse();
  }

  // 模型相关
  if (pathname === '/v1/models') {
    return handleListModels();
  }
  if (pathname === '/v1/models/current') {
    return handleGetCurrentModel();
  }

  // 监控相关
  if (pathname === '/v1/monitor/summary') {
    return handleMonitorSummary();
  }

  // SSE 事件流
  if (pathname === '/v1/events') {
    if (req.method === 'GET') {
      return handleEvents();
    }
    // HEAD 用于心跳保活，返回 200 即可
    if (req.method === 'HEAD') {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
  }

  // 系统配置
  if (pathname === '/v1/config') {
    return handleGetConfig();
  }

  // 会话管理
  if (pathname === '/v1/sessions') {
    if (req.method === 'POST') return handleCreateSession();
    return handleListSessions();
  }
  if (pathname === '/v1/sessions/current') {
    return handleGetCurrentSession();
  }

  // 成本相关
  if (pathname === '/api/cost/summary') {
    return handleCostSummary();
  }
  if (pathname === '/api/cost/records') {
    return handleCostRecords();
  }

  // 健康检查
  if (pathname === '/health' || pathname === '/api/health') {
    return healthResponse();
  }

  // 404
  return jsonResponse({ error: 'Not Found', path: pathname }, 404);
}

// ================================================================
// 内联路由实现（仅使用 Bun/Node 原生 API）
// ================================================================

/**
 * GET /v1/models — 模型列表
 */
function handleListModels(): Promise<Response> {
  return Promise.resolve(
    jsonResponse({
      data: [{ id: 'default', name: '默认模型', provider: 'system' }],
    })
  );
}

/**
 * GET /v1/models/current — 当前模型
 */
function handleGetCurrentModel(): Promise<Response> {
  return Promise.resolve(jsonResponse({ id: 'default', name: '默认模型' }));
}

/**
 * GET /v1/config — 系统配置
 *
 * 返回当前系统配置信息，前端用于初始化页面状态。
 */
function handleGetConfig(): Promise<Response> {
  return Promise.resolve(
    jsonResponse({
      version: '7.9.0',
      mode: 'daemon',
      ai: {
        providers: [
          { id: 'deepseek', name: 'DeepSeek', enabled: true },
          { id: 'ollama', name: 'Ollama', enabled: false },
        ],
      },
      features: {
        chat: true,
        sessions: true,
        tools: false,
        agents: false,
      },
    })
  );
}

/**
 * GET /v1/sessions — 会话列表
 */
function handleListSessions(): Promise<Response> {
  return Promise.resolve(jsonResponse({ data: [], total: 0 }));
}

/**
 * POST /v1/sessions — 创建会话
 */
function handleCreateSession(): Promise<Response> {
  return Promise.resolve(
    jsonResponse({ data: { id: '', name: '新会话' }, message: 'created' }, 201)
  );
}

/**
 * GET /v1/sessions/current — 当前会话
 */
function handleGetCurrentSession(): Promise<Response> {
  return Promise.resolve(jsonResponse({ data: null }));
}

/**
 * GET /v1/monitor/summary — 系统监控摘要
 *
 * 返回与前端 MonitorSummary 接口匹配的扁平结构：
 * { uptime, cpuPercent, memoryPercent, memoryUsedMB, memoryTotalMB, ... }
 */
function handleMonitorSummary(): Promise<Response> {
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
  const usedMemMB = totalMemMB - freeMemMB;
  const uptime = Math.floor(process.uptime());
  const loadAvg = (os.loadavg?.() as number[]) || [0, 0, 0];
  const cpuCores = os.cpus()?.length || 0;
  const memoryPercent =
    totalMemMB > 0 ? Math.round((usedMemMB / totalMemMB) * 100) : 0;
  const cpuPercent =
    cpuCores > 0 ? Math.min(Math.round((loadAvg[0] / cpuCores) * 100), 100) : 0;

  return Promise.resolve(
    jsonResponse({
      uptime,
      cpuPercent,
      memoryPercent,
      memoryUsedMB: usedMemMB,
      memoryTotalMB: totalMemMB,
      diskTotalGB: 0,
      diskUsedGB: 0,
      diskFreeGB: 0,
      diskUsagePercent: 0,
      loadAverage: loadAvg,
      requestCount: 0,
      errorCount: 0,
      avgResponseTime: 0,
    })
  );
}

/**
 * GET /v1/events — SSE 事件流
 *
 * 返回 Server-Sent Events 流，前端通过 EventSource 接收实时事件。
 * 每 15 秒发送心跳保持连接，避免浏览器断开。
 */
function handleEvents(): Promise<Response> {
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const body = new ReadableStream({
    start(controller) {
      // 发送初始连接事件
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"type":"connected","message":"SSE 连接已建立"}\n\n'
        )
      );

      // 每 15 秒发送心跳
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"heartbeat"}\n\n')
          );
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return Promise.resolve(
    new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  );
}

/**
 * GET /api/cost/summary — 成本摘要
 *
 * 返回与前端 CostSummary 接口匹配的结构：
 * { todayCost, weeklyCost, monthlyCost, yearlyCost, sessionCost,
 *   sessionInputTokens, sessionOutputTokens, totalTokens, ... }
 */
function handleCostSummary(): Promise<Response> {
  return Promise.resolve(
    jsonResponse({
      todayCost: 0,
      weeklyCost: 0,
      monthlyCost: 0,
      yearlyCost: 0,
      todayTokens: 0,
      monthlyTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalRequests: 0,
      sessionCost: 0,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionTokens: 0,
      topProviders: [],
      dailyBreakdown: [],
    })
  );
}

/**
 * GET /api/cost/records — 成本记录
 */
function handleCostRecords(): Promise<Response> {
  return Promise.resolve(jsonResponse({ data: [], total: 0 }));
}

/**
 * 健康检查响应
 */
function healthResponse(): Promise<Response> {
  return Promise.resolve(jsonResponse({ status: 'ok', mode: 'daemon' }));
}

// ================================================================
// 辅助函数
// ================================================================

/**
 * 生成 JSON 响应
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * 后台异步尝试初始化真实 API 处理器
 *
 * 使用 timeout 防止 @modules/* 导入挂起导致请求超时。
 * 加载成功后设置 shared.realHandler 供后续请求使用。
 */
async function tryInitRealHandler(shared: {
  realHandler: ((req: Request) => Promise<Response>) | null;
}): Promise<void> {
  try {
    // 5 秒超时，防止 @modules/* 导入挂起
    await Promise.race([
      doInitRealHandler(shared),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('初始化真实处理器超时')), 5000)
      ),
    ]);
  } catch (e) {
    console.log('[DIAG] 真实处理器初始化失败:', String(e));
    console.log('[DIAG] 将继续使用内联处理器');
  }
}

/**
 * 真实处理器初始化逻辑
 */
async function doInitRealHandler(shared: {
  realHandler: ((req: Request) => Promise<Response>) | null;
}): Promise<void> {
  const { default: http } = await import('node:http');

  // 动态导入 LocalHTTPService
  const { LocalHTTPService } =
    await import('@modules/infrastructure/http/LocalHTTPService');

  // 创建服务实例
  const service = new LocalHTTPService({ host: '127.0.0.1', port: 0 });

  // 创建 node:http 服务器
  const realServer = http.createServer((nodeReq, nodeRes) => {
    // LocalHTTPService 内部有 request 事件监听器
    // 这里我们利用 server 的 events 机制
    realServer.emit('request', nodeReq, nodeRes);
  });

  // 监听随机端口
  await new Promise<void>((resolve, reject) => {
    realServer.listen(0, '127.0.0.1', () => resolve());
    realServer.on('error', reject);
  });

  const realPort = (realServer.address() as { port: number }).port;
  console.log('[DIAG] 真实 API 处理器已启动（端口:', realPort, '）');

  // 设置桥接函数
  shared.realHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const body =
      req.method !== 'GET' && req.method !== 'HEAD'
        ? await req.text()
        : undefined;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('请求代理超时'));
      }, 30000);

      const headerEntries: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headerEntries[key] = value;
      });

      const nodeReq = http.request(
        {
          hostname: '127.0.0.1',
          port: realPort,
          path: url.pathname + url.search,
          method: req.method,
          headers: headerEntries,
        },
        (nodeRes) => {
          clearTimeout(timeout);
          const chunks: Buffer[] = [];
          nodeRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          nodeRes.on('end', () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: nodeRes.statusCode,
                headers: nodeRes.headers as Record<string, string>,
              })
            );
          });
        }
      );

      nodeReq.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      if (body) {
        nodeReq.write(body);
      }
      nodeReq.end();
    });
  };

  console.log('[DIAG] 真实 API 处理器桥接就绪');
}
