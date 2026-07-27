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

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

/**
 * monitoring-handlers.ts — 监控相关 HTTP 处理器（从 LocalHTTPService 提取）
 */

import type http from 'http';
import os from 'os';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring';
import { StructuredLogger } from '@modules/monitoring';
import { getMonitoringService } from '@modules/monitoring';
import {
  getSystemCpuPercentAsync,
  getDiskInfoAsync,
} from '@modules/monitoring';

const logger = new Logger({
  module: 'infrastructure:http:handlers:monitoring-handlers',
  level: LogLevel.INFO,
});

// ── 指标数据环形缓冲区 ────────────────────────────────────────────

interface MetricPoint {
  timestamp: number;
  value: number;
}

const MAX_BUFFER_POINTS = 360;
// 系统级指标
let cpuHistory: MetricPoint[] = [];
let memoryHistory: MetricPoint[] = [];
// 应用级指标（当前进程）
let appCpuHistory: MetricPoint[] = [];
let appMemoryHistory: MetricPoint[] = [];

// 进程 CPU 采样辅助（用于计算 CPU 使用率增量）
let prevCpuUsage: { user: number; system: number } | null = null;
let prevCpuSampleTime: number = 0;

/**
 * 计算当前进程的 CPU 使用率（%）
 * 基于 process.cpuUsage() 的增量除以时间间隔
 */
function sampleProcessCpuPercent(): number {
  const now = Date.now();
  const currentUsage = process.cpuUsage();
  if (!prevCpuUsage) {
    // 首次采样，只记录基准值
    prevCpuUsage = currentUsage;
    prevCpuSampleTime = now;
    return 0;
  }
  const deltaUser = currentUsage.user - prevCpuUsage.user;
  const deltaSystem = currentUsage.system - prevCpuUsage.system;
  const deltaTotalUs = deltaUser + deltaSystem; // 微秒
  const elapsedMs = now - prevCpuSampleTime;
  prevCpuUsage = currentUsage;
  prevCpuSampleTime = now;
  if (elapsedMs <= 0) return 0;
  // CPU% = (总CPU微秒 / (毫秒 * 1000)) * 100 = 微秒 / (毫秒 * 10)
  const percent = deltaTotalUs / (elapsedMs * 10);
  return Math.min(Math.round(percent * 10) / 10, 100);
}

/**
 * 采样当前进程的内存使用量（MB）
 */
function sampleProcessMemoryMB(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 100) / 100;
}

/**
 * 向环形缓冲区添加一个数据点
 */
function pushMetric(buffer: MetricPoint[], point: MetricPoint): void {
  buffer.push(point);
  if (buffer.length > MAX_BUFFER_POINTS) {
    buffer.shift();
  }
}

/**
 * 从缓冲区中筛选指定时间范围内的数据点
 */
function filterMetric(buffer: MetricPoint[], range: number): MetricPoint[] {
  const cutoff = Date.now() - range;
  return buffer.filter((p) => p.timestamp >= cutoff);
}

// ── 处理器 ────────────────────────────────────────────────────────

/**
 * GET /v1/monitor/summary — 监控摘要
 */
export async function handleMonitorSummary(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const service = getMonitoringService();
    const status = service.getSystemStatus();

    const cpuPercent = await getSystemCpuPercentAsync();
    const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
    const usedMemMB = totalMemMB - freeMemMB;
    const memoryPercent =
      totalMemMB > 0 ? Math.round((usedMemMB / totalMemMB) * 100) : 0;
    const disk = await getDiskInfoAsync();
    const loadAverage =
      status.loadAverage.length > 0
        ? status.loadAverage.map((l) => Math.round(l * 100) / 100)
        : [];

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        uptime: Math.floor(status.uptime),
        cpuPercent,
        memoryPercent,
        memoryUsedMB: usedMemMB,
        memoryTotalMB: totalMemMB,
        diskTotalGB: disk.totalGB,
        diskUsedGB: disk.usedGB,
        diskFreeGB: disk.freeGB,
        diskUsagePercent: disk.percent,
        loadAverage,
        requestCount: 0,
        errorCount: 0,
        avgResponseTime: 0,
      })
    );
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        uptime: 0,
        cpuPercent: 0,
        memoryPercent: 0,
        memoryUsedMB: 0,
        memoryTotalMB: 0,
        diskTotalGB: 0,
        diskUsedGB: 0,
        diskFreeGB: 0,
        diskUsagePercent: 0,
        loadAverage: [],
        requestCount: 0,
        errorCount: 0,
        avgResponseTime: 0,
      })
    );
  }
}

/**
 * GET /v1/monitor/metrics — 监控指标
 * 返回系统级与应用级（当前进程）CPU/内存双线数据
 */
export async function handleMonitorMetrics(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const now = Date.now();

    // 系统级采样
    const sysCpu = await getSystemCpuPercentAsync();
    const sysMem =
      Math.round(((os.totalmem() - os.freemem()) / 1024 / 1024) * 100) / 100;

    // 应用级（进程级）采样
    const appCpu = sampleProcessCpuPercent();
    const appMem = sampleProcessMemoryMB();

    // 追加到各自的环形缓冲区
    pushMetric(cpuHistory, { timestamp: now, value: sysCpu });
    pushMetric(memoryHistory, { timestamp: now, value: sysMem });
    pushMetric(appCpuHistory, { timestamp: now, value: appCpu });
    pushMetric(appMemoryHistory, { timestamp: now, value: appMem });

    const range = 3600000; // 默认返回最近 1 小时数据
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        requests: [],
        responseTime: [],
        errorRate: [],
        cpu: filterMetric(cpuHistory, range), // 系统 CPU
        memory: filterMetric(memoryHistory, range), // 系统内存
        appCpu: filterMetric(appCpuHistory, range), // 应用 CPU
        appMemory: filterMetric(appMemoryHistory, range), // 应用内存
      })
    );
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        requests: [],
        responseTime: [],
        errorRate: [],
        cpu: [],
        memory: [],
        appCpu: [],
        appMemory: [],
      })
    );
  }
}

/**
 * GET /v1/monitor/alerts — 告警列表
 */
export async function handleMonitorAlerts(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const service = getMonitoringService();
    const alerts = service.getAlerts().map((msg, index) => ({
      id: `alert-${index}`,
      level: 'info' as const,
      message: msg,
      timestamp: Date.now(),
      acknowledged: false,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(alerts));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify([]));
  }
}

/**
 * POST /v1/monitor/alerts/:id/acknowledge — 确认告警
 */
export async function handleAcknowledgeAlert(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  params?: Record<string, string>
): Promise<void> {
  const alertId = params?.['$1'] || 'unknown';
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true, id: alertId }));
}

/**
 * GET /v1/monitor/logs — 日志查询
 */
export async function handleMonitorLogs(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const level = urlObj.searchParams.get('level');
    const search = urlObj.searchParams.get('search');
    const source = urlObj.searchParams.get('source');
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);

    const levelMap: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
    };

    let entries = StructuredLogger.queryLogs({
      level: level && levelMap[level] ? levelMap[level] : undefined,
      limit: 1000,
    });

    if (source && source !== 'all')
      entries = entries.filter((e) => e.source === source);
    if (search) {
      const lowerSearch = search.toLowerCase();
      entries = entries.filter((e) => {
        const inMessage =
          e.message && e.message.toLowerCase().includes(lowerSearch);
        const inData = e.data
          ? JSON.stringify(e.data).toLowerCase().includes(lowerSearch)
          : false;
        const inModule =
          e.module && e.module.toLowerCase().includes(lowerSearch);
        return inMessage || inData || inModule;
      });
    }

    const total = entries.length;
    const logs = entries.slice(offset, offset + limit).map((entry, idx) => ({
      id: `log-${idx}-${Date.now()}`,
      level:
        entry.level === LogLevel.WARNING ? 'warn' : (entry.level as string),
      message: entry.message,
      timestamp: new Date(entry.timestamp).getTime(),
      source: entry.source,
      module: entry.module,
      details: entry.data
        ? JSON.stringify(entry.data)
        : entry.error
          ? entry.error.message
          : undefined,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ logs, total }));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ logs: [], total: 0 }));
  }
}

/**
 * POST /v1/monitor/logs/export — 日志导出
 */
export async function handleExportLogs(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    let body = '';
    await new Promise((resolve) => {
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', resolve);
    });

    const params = JSON.parse(body) || {};
    const format = params.format || 'json';
    const level = params.level;
    const source = params.source;
    const search = params.search;

    const levelMap: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
    };

    let entries = StructuredLogger.queryLogs({
      level: level && levelMap[level] ? levelMap[level] : undefined,
      limit: 10000,
    });

    if (source && source !== 'all')
      entries = entries.filter((e) => e.source === source);
    if (search) {
      const lowerSearch = search.toLowerCase();
      entries = entries.filter((e) => {
        const inMessage =
          e.message && e.message.toLowerCase().includes(lowerSearch);
        const inData = e.data
          ? JSON.stringify(e.data).toLowerCase().includes(lowerSearch)
          : false;
        const inModule =
          e.module && e.module.toLowerCase().includes(lowerSearch);
        return inMessage || inData || inModule;
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `logs-${timestamp}`;

    if (format === 'csv') {
      const csvHeader = 'timestamp,level,module,source,message,data\n';
      const csvRows = entries.map((entry) => {
        const dataStr = entry.data
          ? JSON.stringify(entry.data).replace(/"/g, '""')
          : '';
        return [
          `"${entry.timestamp}"`,
          `"${entry.level}"`,
          `"${entry.module || ''}"`,
          `"${entry.source || ''}"`,
          `"${entry.message.replace(/"/g, '""')}"`,
          `"${dataStr}"`,
        ].join(',');
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      });
      res.end(csvHeader + csvRows.join('\n'));
    } else {
      const exportData = {
        exportTime: new Date().toISOString(),
        total: entries.length,
        filters: { level, source, search },
        logs: entries.map((entry) => ({
          timestamp: entry.timestamp,
          level: entry.level,
          module: entry.module,
          source: entry.source,
          message: entry.message,
          data: entry.data,
          traceId: entry.traceId,
          error: entry.error,
        })),
      };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.json"`,
      });
      res.end(JSON.stringify(exportData, null, 2));
    }
  } catch (error) {
    logger.error('导出日志失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '导出日志失败' }));
  }
}

/**
 * GET /v1/monitor/sessions — LLM 会话列表
 */
export async function handleMonitorSessions(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getLLMTracker } =
      await import('@modules/monitoring/llm/getLLMTracker');
    const llmTracker = getLLMTracker();
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const sessions = llmTracker.getAllSessions();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        sessions: sessions.slice(offset, offset + limit),
        total: sessions.length,
      })
    );
  } catch (error) {
    logger.error('获取会话列表失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取会话列表失败' }));
  }
}

/**
 * GET /v1/monitor/sessions/:sessionId — LLM 会话详情
 */
export async function handleMonitorSessionDetail(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  params?: Record<string, string>
): Promise<void> {
  try {
    const sessionId = params?.['$1'] || '';
    const { getLLMTracker } =
      await import('@modules/monitoring/llm/getLLMTracker');
    const sessionDetail = getLLMTracker().getSessionDetail(sessionId);
    if (!sessionDetail) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(sessionDetail));
  } catch (error) {
    logger.error('获取会话详情失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取会话详情失败' }));
  }
}

/**
 * GET /v1/monitor/sessions/summary — LLM 会话全局汇总
 */
export async function handleSessionsSummary(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getLLMTracker } =
      await import('@modules/monitoring/llm/getLLMTracker');
    const summary = getLLMTracker().getGlobalSummary();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(summary));
  } catch (error) {
    logger.error('获取会话汇总失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取会话汇总失败' }));
  }
}

/**
 * GET /v1/monitor/otel/metrics — OTel 指标快照
 */
export async function handleOTelMetrics(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getOTelMetrics } =
      await import('@modules/monitoring/otel/OTelMetrics');
    const oTelMetrics = getOTelMetrics();

    // OTel Metrics 是 Push 模型，无法直接查询值。
    // 通过读取内部缓存快照获取关键指标。
    const snapshot: Record<string, unknown> = {};

    // 提取计数器缓存
    if (oTelMetrics && typeof oTelMetrics === 'object') {
      const descriptors = Object.getOwnPropertyDescriptors(oTelMetrics);
      for (const [key, desc] of Object.entries(descriptors)) {
        if (desc.value && typeof desc.value === 'object') {
          const val = desc.value as Record<string, unknown>;
          // 暴露 MeterProvider 配置状态
          if (key === 'enabled' || key === 'config') {
            snapshot[key] = val;
          }
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        enabled: (oTelMetrics as any)?.enabled ?? false,
        serviceName: (oTelMetrics as any)?.config?.serviceName,
        snapshot,
      })
    );
  } catch (error) {
    logger.error('获取 OTel 指标失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取 OTel 指标失败' }));
  }
}

/**
 * GET /v1/infrastructure/status — 基础设施聚合状态
 *
 * 聚合 SystemHealthChecker + infraHealthChecker(Provider/EventLoop) + 通道健康
 */
export async function handleInfrastructureStatus(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { infraHealthChecker } =
      await import('@modules/diagnostics/infrastructure-diagnostics');
    const { getLLMTracker } =
      await import('@modules/monitoring/llm/getLLMTracker');
    const { getOTelMetrics } =
      await import('@modules/monitoring/otel/OTelMetrics');
    const { getHealthMonitor } =
      await import('@modules/monitoring/HealthMonitor.js');

    const [healthResult, llmSummary] = await Promise.allSettled([
      infraHealthChecker.runAllChecks(),
      Promise.resolve(getLLMTracker().getGlobalSummary()),
    ]);

    // 系统健康检查（独立于 HealthChecker）
    let sysHealth = null;
    try {
      const { systemHealthChecker } =
        await import('@modules/diagnostics/SystemHealthChecker');
      sysHealth = await systemHealthChecker.performFullCheck();
    } catch (err) {
      sysHealth = null;
    }

    // 通道健康状态
    let channelStatuses: unknown[] = [];
    try {
      const healthMonitor = getHealthMonitor();
      channelStatuses = healthMonitor.getAllHealthStatuses();
    } catch (err) {
      channelStatuses = [];
    }

    // OTel 启用状态
    let otelEnabled = false;
    try {
      otelEnabled = (getOTelMetrics() as any)?.enabled ?? false;
    } catch (err) {
      // 默认 false
    }

    const checks =
      healthResult.status === 'fulfilled' ? healthResult.value : null;
    const llm = llmSummary.status === 'fulfilled' ? llmSummary.value : null;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        timestamp: Date.now(),
        health: checks
          ? {
              overall: checks.overall,
              summary: checks.summary,
              checks: checks.checks.map((c) => ({
                name: c.name,
                status: c.status,
                latency: c.latency,
                error: c.error,
              })),
            }
          : null,
        system: sysHealth
          ? {
              overallStatus: sysHealth.overallStatus,
              resourceUsage: sysHealth.resourceUsage,
              recommendations: sysHealth.recommendations,
            }
          : null,
        channels: channelStatuses,
        llm: llm
          ? {
              totalSessions: llm.totalSessions,
              totalRequests: llm.totalRequests,
              totalInputTokens: llm.totalInputTokens,
              totalOutputTokens: llm.totalOutputTokens,
              totalCostUsd: llm.totalCostUsd,
            }
          : null,
        otel: { enabled: otelEnabled },
        eventLoop: { monitoring: true },
      })
    );
  } catch (error) {
    logger.error('获取基础设施状态失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取基础设施状态失败' }));
  }
}

// ── 路径幻觉守卫指标（P2 可观测性） ──────────────────────────────────

/**
 * GET /v1/metrics/path-guard
 * 返回 PathGuardService 的累计指标
 */
export async function handlePathGuardMetrics(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getPathGuardMetrics } =
      await import('@modules/chat/services/PathGuardService');
    const metrics = getPathGuardMetrics();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(metrics));
  } catch (error) {
    logger.error('获取路径守卫指标失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取路径守卫指标失败' }));
  }
}

/**
 * POST /v1/metrics/path-guard/reset
 * 重置 PathGuardService 的累计指标
 */
export async function handlePathGuardMetricsReset(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { resetPathGuardMetrics } =
      await import('@modules/chat/services/PathGuardService');
    resetPathGuardMetrics();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    logger.error('重置路径守卫指标失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '重置路径守卫指标失败' }));
  }
}

// ── 启动错误日志查询 ──────────────────────────────────

/**
 * GET /v1/diagnostics/startup-error
 * 返回上次启动失败的日志（供客户端在启动失败后展示）
 */
export async function handleStartupError(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { resolveLogsDir } = await import('@modules/core/paths');
    const logPath = join(resolveLogsDir(), 'startup-error.log');

    if (!existsSync(logPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: null, source: 'no-error-file' }));
      return;
    }

    const content = readFileSync(logPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: content, source: 'startup-error.log' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}
