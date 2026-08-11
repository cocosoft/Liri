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

import type http from 'http';
import type { HandlerCtx } from './handler-utils';

// ========== Buddy Handlers ==========

/**
 * 处理获取 Buddy 伙伴信息请求
 */
export async function handleGetBuddy(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCompanion } = await import('@modules/buddy');
    const companion = getCompanion();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(companion || null));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(null));
  }
}

/**
 * 处理 Buddy 交互请求
 */
export async function handleBuddyInteract(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { action } = JSON.parse(body);
    const { InteractionManager, getCompanion } = await import('@modules/buddy');
    const companion = getCompanion();
    if (!companion) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: '暂无 Buddy', statChanges: {} }));
      return;
    }
    const manager = new InteractionManager();
    const result = await manager.execute(companion, action);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    ctx.broadcastEvent('buddy:interacted', {
      action,
      result: result.response,
    });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理获取 Buddy 统计数据请求
 */
export async function handleGetBuddyStats(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getDreamStats } = await import('@modules/buddy/dreamLogStore');
    const dreamStats = await getDreamStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        interactions: 0,
        dreamsCompleted: dreamStats.totalCompleted,
        totalXp: 0,
      })
    );
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ interactions: 0, dreamsCompleted: 0, totalXp: 0 })
    );
  }
}

/**
 * 处理获取梦境日志请求
 */
export async function handleGetDreamLogs(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`
    );
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const typeFilter = urlObj.searchParams.get('type') || '';

    const { getDreamLogs, getDreamLogsByType, getDreamStats } =
      await import('@modules/buddy/dreamLogStore');

    const result = typeFilter
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await getDreamLogsByType(typeFilter as any, limit, offset)
      : await getDreamLogs(limit, offset);

    const stats = await getDreamStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...result, stats }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        logs: [],
        total: 0,
        stats: {
          totalCompleted: 0,
          totalFailed: 0,
          totalSessions: 0,
          totalInsights: 0,
        },
      })
    );
  }
}

/**
 * 处理获取后台任务运行状况请求
 * 聚合：Dream（记忆整理）+ Buddy 成长统计 + 最近执行日志。
 * 供前端"运行状况"面板展示，回答"功能承诺 vs 实际执行"。
 */
export async function handleGetBackgroundStatus(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const [
      { getDreamStats, getDreamLogs },
      { loadGrowthState },
      { getBackgroundTaskLog, detectTaskAlerts },
    ] = await Promise.all([
      import('@modules/buddy/dreamLogStore'),
      import('@modules/buddy/growthPersistence'),
      import('@modules/monitoring/BackgroundTaskEvent'),
    ]);

    const dreamStats = await getDreamStats();
    const recentLogs = await getDreamLogs(10);

    // 成长统计从持久化层读取（与 DreamGrowthTracker 共享同一文件）
    const growth = await loadGrowthState();
    // §9.3 统一后台任务事件日志（R08-002 配套，各后台模块四态事件）
    const recentTasks = await getBackgroundTaskLog(20);
    // §9.3 阶段 2：连续失败/持续跳过提醒（阈值 3 次）
    const alerts = detectTaskAlerts();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        dream: {
          stats: dreamStats,
          recentLogs: recentLogs.logs,
        },
        buddyGrowth: {
          totalCompleted: growth.totalCompleted,
          totalSessions: growth.totalSessions,
          userSessions: growth.userSessions,
          totalInsights: growth.totalInsights,
          consecutiveDays: growth.consecutiveDays,
          taskCompletionCount: growth.taskCompletionCount,
          totalTaskExp: growth.totalTaskExp,
          unlockedAchievements: growth.unlockedAchievements,
        },
        tasks: recentTasks,
        alerts,
        generatedAt: Date.now(),
      })
    );
  } catch (err) {
    ctx.sendError(res, err);
  }
}
