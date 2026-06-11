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
 * monitoring-handlers.ts — 监控相关 HTTP 处理器（从 LocalHTTPService 提取）
 */

import type http from 'node:http';
import os from 'node:os';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { StructuredLogger } from '@modules/monitoring/logs/StructuredLogger';
import { getMonitoringService } from '@modules/monitoring/MonitoringService';

const logger = new Logger({ level: LogLevel.INFO });

// ── CPU 计算器 ────────────────────────────────────────────────────

/**
 * 基于 process.cpuUsage 差值计算 CPU 使用率的状态存储
 */
const cpuState = {
  prevUsage: null as NodeJS.CpuUsage | null,
  prevTime: 0,
};

/**
 * 计算当前 CPU 使用率（0~100 的百分比）
 */
export function calcCpuPercent(): number {
  const currentCpu = process.cpuUsage();
  const currentTime = Date.now();

  if (!cpuState.prevUsage || cpuState.prevTime === 0) {
    cpuState.prevUsage = currentCpu;
    cpuState.prevTime = currentTime;
    return 0;
  }

  const userDiff = currentCpu.user - cpuState.prevUsage.user;
  const sysDiff = currentCpu.system - cpuState.prevUsage.system;
  const cpuDiff = userDiff + sysDiff;
  const timeDiff = currentTime - cpuState.prevTime;

  cpuState.prevUsage = currentCpu;
  cpuState.prevTime = currentTime;

  if (timeDiff <= 0 || cpuDiff < 0) return 0;

  const cpuCount = os.cpus().length;
  const percent = (cpuDiff * 100) / (timeDiff * 1000 * cpuCount);
  return Math.min(Math.round(percent * 10) / 10, 100);
}

// ── 磁盘信息收集 ──────────────────────────────────────────────────

/**
 * 收集磁盘总容量和可用空间
 */
function collectDiskInfo(): { totalGB: number; freeGB: number; usedGB: number; percent: number } {
  let totalGB = 0;
  let freeGB = 0;
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      const output = execSync(
        'wmic logicaldisk where DriveType=3 get Size,FreeSpace',
        { encoding: 'utf8', timeout: 3000 },
      );
      const lines = output.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const size = parseFloat(parts[0]);
          const free = parseFloat(parts[1]);
          if (!isNaN(size) && !isNaN(free)) {
            totalGB += size;
            freeGB += free;
          }
        }
      }
    } else {
      const { execSync } = require('child_process');
      const output = execSync('df -k --total 2>/dev/null || df -k', {
        encoding: 'utf8',
        timeout: 3000,
      });
      const lines = output.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[0] !== 'total') {
          const total = parseFloat(parts[1]) * 1024;
          const available = parseFloat(parts[3]) * 1024;
          if (!isNaN(total) && !isNaN(available)) {
            totalGB += total;
            freeGB += available;
          }
        }
      }
    }
  } catch {
    // 磁盘信息不可用时静默处理
  }

  const usedGB = totalGB - freeGB;
  const percent = totalGB > 0 ? Math.round((usedGB / totalGB) * 100) : 0;
  const gb = 1024 * 1024 * 1024;

  return {
    totalGB: Math.round((totalGB / gb) * 100) / 100,
    freeGB: Math.round((freeGB / gb) * 100) / 100,
    usedGB: Math.round((usedGB / gb) * 100) / 100,
    percent,
  };
}

// ── 处理器 ────────────────────────────────────────────────────────

/**
 * GET /v1/monitor/summary — 监控摘要
 */
export async function handleMonitorSummary(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const service = getMonitoringService();
    const status = service.getSystemStatus();

    const cpuPercent = calcCpuPercent();
    const rssMB = Math.round(status.memory.rss / 1024 / 1024);
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
    const memoryPercent = totalMemMB > 0 ? Math.round((rssMB / totalMemMB) * 100) : 0;
    const disk = collectDiskInfo();
    const loadAverage = status.loadAverage.length > 0
      ? status.loadAverage.map((l) => Math.round(l * 100) / 100)
      : [];

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      uptime: Math.floor(status.uptime),
      cpuPercent,
      memoryPercent,
      memoryUsedMB: rssMB,
      memoryTotalMB: totalMemMB,
      diskTotalGB: disk.totalGB,
      diskUsedGB: disk.usedGB,
      diskFreeGB: disk.freeGB,
      diskUsagePercent: disk.percent,
      loadAverage,
      requestCount: 0,
      errorCount: 0,
      avgResponseTime: 0,
    }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      uptime: 0, cpuPercent: 0, memoryPercent: 0, memoryUsedMB: 0,
      memoryTotalMB: 0, diskTotalGB: 0, diskUsedGB: 0, diskFreeGB: 0,
      diskUsagePercent: 0, loadAverage: [], requestCount: 0,
      errorCount: 0, avgResponseTime: 0,
    }));
  }
}

/**
 * GET /v1/monitor/metrics — 监控指标
 */
export async function handleMonitorMetrics(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const service = getMonitoringService();
    const status = service.getSystemStatus();
    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      requests: [], responseTime: [], errorRate: [],
      cpu: [{ timestamp: now, value: calcCpuPercent() }],
      memory: [{ timestamp: now, value: Math.round((status.memory.rss / 1024 / 1024) * 100) / 100 }],
    }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ requests: [], responseTime: [], errorRate: [], cpu: [], memory: [] }));
  }
}

/**
 * GET /v1/monitor/alerts — 告警列表
 */
export async function handleMonitorAlerts(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const service = getMonitoringService();
    const alerts = service.getAlerts().map((msg, index) => ({
      id: `alert-${index}`, level: 'info' as const, message: msg,
      timestamp: Date.now(), acknowledged: false,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(alerts));
  } catch {
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
  params?: Record<string, string>,
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
  res: http.ServerResponse,
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const level = urlObj.searchParams.get('level');
    const search = urlObj.searchParams.get('search');
    const source = urlObj.searchParams.get('source');
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);

    const levelMap: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG, info: LogLevel.INFO,
      warn: LogLevel.WARN, error: LogLevel.ERROR,
    };

    let entries = StructuredLogger.queryLogs({
      level: level && levelMap[level] ? levelMap[level] : undefined,
      limit: 1000,
    });

    if (source && source !== 'all') entries = entries.filter((e) => e.source === source);
    if (search) {
      const lowerSearch = search.toLowerCase();
      entries = entries.filter((e) => {
        const inMessage = e.message && e.message.toLowerCase().includes(lowerSearch);
        const inData = e.data ? JSON.stringify(e.data).toLowerCase().includes(lowerSearch) : false;
        const inModule = e.module && e.module.toLowerCase().includes(lowerSearch);
        return inMessage || inData || inModule;
      });
    }

    const total = entries.length;
    const logs = entries.slice(offset, offset + limit).map((entry, idx) => ({
      id: `log-${idx}-${Date.now()}`,
      level: entry.level === LogLevel.WARNING ? 'warn' : (entry.level as string),
      message: entry.message,
      timestamp: new Date(entry.timestamp).getTime(),
      source: entry.source,
      module: entry.module,
      details: entry.data ? JSON.stringify(entry.data) : entry.error ? entry.error.message : undefined,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ logs, total }));
  } catch {
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
  res: http.ServerResponse,
): Promise<void> {
  try {
    let body = '';
    await new Promise((resolve) => {
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', resolve);
    });

    const params = JSON.parse(body) || {};
    const format = params.format || 'json';
    const level = params.level;
    const source = params.source;
    const search = params.search;

    const levelMap: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG, info: LogLevel.INFO,
      warn: LogLevel.WARN, error: LogLevel.ERROR,
    };

    let entries = StructuredLogger.queryLogs({
      level: level && levelMap[level] ? levelMap[level] : undefined,
      limit: 10000,
    });

    if (source && source !== 'all') entries = entries.filter((e) => e.source === source);
    if (search) {
      const lowerSearch = search.toLowerCase();
      entries = entries.filter((e) => {
        const inMessage = e.message && e.message.toLowerCase().includes(lowerSearch);
        const inData = e.data ? JSON.stringify(e.data).toLowerCase().includes(lowerSearch) : false;
        const inModule = e.module && e.module.toLowerCase().includes(lowerSearch);
        return inMessage || inData || inModule;
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `logs-${timestamp}`;

    if (format === 'csv') {
      const csvHeader = 'timestamp,level,module,source,message,data\n';
      const csvRows = entries.map((entry) => {
        const dataStr = entry.data ? JSON.stringify(entry.data).replace(/"/g, '""') : '';
        return [
          `"${entry.timestamp}"`, `"${entry.level}"`, `"${entry.module || ''}"`,
          `"${entry.source || ''}"`, `"${entry.message.replace(/"/g, '""')}"`, `"${dataStr}"`,
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
          timestamp: entry.timestamp, level: entry.level,
          module: entry.module, source: entry.source,
          message: entry.message, data: entry.data,
          traceId: entry.traceId, error: entry.error,
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
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { getLLMTracker } = await import('@modules/monitoring/llm/getLLMTracker');
    const llmTracker = getLLMTracker();
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const sessions = llmTracker.getAllSessions();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sessions: sessions.slice(offset, offset + limit), total: sessions.length }));
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
  params?: Record<string, string>,
): Promise<void> {
  try {
    const sessionId = params?.['$1'] || '';
    const { getLLMTracker } = await import('@modules/monitoring/llm/getLLMTracker');
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
 * GET /v1/monitor/cost — 成本统计
 */
export async function handleMonitorCost(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { getLLMTracker } = await import('@modules/monitoring/llm/getLLMTracker');
    const globalSummary = getLLMTracker().getGlobalSummary();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(globalSummary));
  } catch (error) {
    logger.error('获取成本统计失败', { error: String(error) });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '获取成本统计失败' }));
  }
}