/**
 * 实时查看服务器
 *
 * 基于 Node.js 内置 http 模块，提供 SSE 实时推送。
 * 当有新的 TraceRecord 录制完成时，自动广播到所有连接的客户端。
 *
 * 参考：claude-tap 的 live.py (Python 实现)
 */

import http from 'http';
import type { TraceRecord } from '../types';
import { ViewerService } from '../viewer/ViewerService';
import { TraceEngine } from '../engine/TraceEngine';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'trace-recording:live:LiveViewServer',
  level: LogLevel.INFO,
});

/** SSE 客户端连接 */
interface SSEClient {
  id: number;
  res: http.ServerResponse;
}

/**
 * 实时查看服务器
 */
export class LiveViewServer {
  private server: http.Server | null = null;
  private engine: TraceEngine | null = null;
  private clients: Map<number, SSEClient> = new Map();
  private clientIdCounter = 0;
  private port: number;
  private viewerService = new ViewerService();

  /**
   * @param port HTTP 监听端口
   */
  constructor(port: number) {
    this.port = port;
  }

  /**
   * 启动服务器
   * @param engine Trace 引擎
   */
  start(engine: TraceEngine): void {
    if (this.server) {
      return;
    }

    this.engine = engine;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.port);
  }

  /**
   * 停止服务器
   */
  stop(): void {
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch (err) {
        // 忽略关闭异常

        logger.debug('Operation skipped', {
          context: '忽略关闭异常',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.clients.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * 获取监听端口
   */
  getPort(): number {
    return this.port;
  }

  /**
   * 获取服务器 URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * 是否正在运行
   */
  get running(): boolean {
    return this.server !== null;
  }

  /**
   * 广播新记录到所有 SSE 客户端
   * @param record 录制记录
   */
  broadcast(record: TraceRecord): void {
    const data = JSON.stringify(record);
    const message = `event: record\ndata: ${data}\n\n`;

    for (const [id, client] of this.clients) {
      try {
        client.res.write(message);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  /**
   * 请求处理
   */
  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const path = url.pathname;

    // SSE 事件流端点
    if (path === '/events') {
      return this.handleSSE(req, res);
    }

    // 记录历史
    if (path === '/records') {
      return this.handleRecords(res);
    }

    // 按日期查询
    if (path.startsWith('/records/')) {
      const date = path.slice('/records/'.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return this.handleRecordsByDate(date, res);
      }
    }

    // 统计
    if (path === '/stats') {
      return this.handleStats(res);
    }

    // HTML 查看器
    if (path === '/' || path === '/index.html') {
      return this.handleViewer(res);
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * 处理 SSE 订阅
   */
  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    const id = ++this.clientIdCounter;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    this.clients.set(id, { id, res });

    // 发送连接成功事件
    res.write(`event: connected\ndata: {"clientId":${id}}\n\n`);

    // 发送 keepalive
    const keepalive = setInterval(() => {
      try {
        res.write(':keepalive\n\n');
      } catch {
        clearInterval(keepalive);
        this.clients.delete(id);
      }
    }, 15000);

    // 客户端断开时清理
    req.on('close', () => {
      clearInterval(keepalive);
      this.clients.delete(id);
    });
  }

  /**
   * 处理记录查询请求
   */
  private handleRecords(res: http.ServerResponse): void {
    if (!this.engine) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }

    const records = this.engine.getAllRecords();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(records));
  }

  /**
   * 按日期查询
   */
  private handleRecordsByDate(date: string, res: http.ServerResponse): void {
    if (!this.engine) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }

    const records = this.engine.getRecordsByDate(date);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(records));
  }

  /**
   * 处理统计请求
   */
  private handleStats(res: http.ServerResponse): void {
    if (!this.engine) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }

    const stats = this.engine.getStatsSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  }

  /**
   * 处理查看器页面
   */
  private handleViewer(res: http.ServerResponse): void {
    if (!this.engine) {
      res.writeHead(503);
      res.end('No data');
      return;
    }

    const records = this.engine.getAllRecords();
    const dateList = this.engine.getAvailableDates();
    const stats = this.engine.getStatsSnapshot();

    const html = this.buildLiveHtml(records, dateList, stats);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /**
   * 构建实时查看器 HTML
   */
  private buildLiveHtml(
    records: TraceRecord[],
    dateList: string[],
    stats: ReturnType<TraceEngine['getStatsSnapshot']>
  ): string {
    const liveViewUrl = this.getUrl();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Trace - Live View</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
h1 { font-size: 24px; margin-bottom: 8px; }
.subtitle { color: #8b949e; margin-bottom: 24px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
.stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
.stat-card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; }
.stat-card .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
.stat-card .value.green { color: #3fb950; }
.stat-card .value.red { color: #f85149; }
.stat-card .value.blue { color: #58a6ff; }
.dates { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
.dates a { color: #58a6ff; text-decoration: none; font-size: 13px; padding: 4px 12px; border: 1px solid #30363d; border-radius: 12px; }
.dates a:hover { background: #1f2937; }
.live-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; background: #1b3a2d; color: #3fb950; margin-left: 8px; }
#event-log { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto; font-size: 12px; font-family: monospace; }
#event-log .entry { padding: 4px 0; border-bottom: 1px solid #21262d; }
#event-log .entry:last-child { border-bottom: none; }
</style>
</head>
<body>
<h1>AI Trace Live View</h1>
<div class="subtitle">
  Live monitoring <span class="live-badge" id="status">disconnected</span>
  <span style="margin-left:12px;color:#8b949e">${records.length} total records | ${dateList.length} days</span>
</div>

<div class="stats">
  <div class="stat-card">
    <div class="label">Total Calls</div>
    <div class="value blue">${stats.totalCalls}</div>
  </div>
  <div class="stat-card">
    <div class="label">Errors</div>
    <div class="value red">${stats.totalErrors}</div>
  </div>
  <div class="stat-card">
    <div class="label">Input Tokens</div>
    <div class="value green">${stats.totalInputTokens.toLocaleString()}</div>
  </div>
  <div class="stat-card">
    <div class="label">Output Tokens</div>
    <div class="value green">${stats.totalOutputTokens.toLocaleString()}</div>
  </div>
  <div class="stat-card">
    <div class="label">P50 Latency</div>
    <div class="value">${stats.latencyP50}ms</div>
  </div>
  <div class="stat-card">
    <div class="label">P99 Latency</div>
    <div class="value">${stats.latencyP99}ms</div>
  </div>
</div>

<div class="dates">
  ${dateList.map((d) => '<a href="/records/' + d + '">' + d + '</a>').join('')}
</div>

<h2 style="margin-bottom:12px">Live Event Log</h2>
<div id="event-log">
  <div class="entry">Waiting for events...</div>
</div>

<script>
(function() {
  const log = document.getElementById('event-log');
  const status = document.getElementById('status');
  const evtSource = new EventSource('/events');

  evtSource.addEventListener('connected', function(e) {
    status.textContent = 'connected';
    status.style.background = '#1b3a2d';
    status.style.color = '#3fb950';
    addEntry('Connected to live stream');
  });

  evtSource.addEventListener('record', function(e) {
    try {
      const record = JSON.parse(e.data);
      const model = (record.request && record.request.body && record.request.body.model) || 'unknown';
      const ms = record.durationMs;
      const statusCode = (record.response && record.response.status) || 0;
      const icon = statusCode >= 400 ? '\u{1F534}' : ms > 30000 ? '\u{1F7E1}' : '\u{1F7E2}';
      addEntry(icon + ' [' + record.timestamp.slice(11, 19) + '] ' + model + ' - ' + ms + 'ms (' + statusCode + ')');
    } catch(err) {
      addEntry('\u26A0 Parse error: ' + err.message);
    }
  });

  evtSource.onerror = function() {
    status.textContent = 'disconnected';
    status.style.background = '#3d1f1f';
    status.style.color = '#f85149';
    addEntry('Connection lost, retrying...');
  };

  function addEntry(text) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 200) {
      log.removeChild(log.firstChild);
    }
  }
})();
</script>
</body>
</html>`;
  }
}
