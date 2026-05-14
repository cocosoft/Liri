/**
 * ControlUI 网关控制面板
 * 对标 CC/OpenClaw 的 WebUI 管理界面，提供网关运行状态监控与管理
 */
import http from 'node:http';
import { EventEmitter } from 'node:events';

/**
 * 控制面板配置
 */
export interface ControlUIConfig {
  enabled: boolean;
  host: string;
  port: number;
  authToken?: string;
  staticDir?: string;
}

/**
 * 面板指标
 */
export interface DashboardMetrics {
  uptime: number;
  activeConnections: number;
  totalRequests: number;
  totalErrors: number;
  memoryUsage: number;
  activeChannels: number;
  registeredTools: number;
  activePlugins: number;
}

/**
 * 面板页面
 */
export interface DashboardPage {
  id: string;
  title: string;
  icon: string;
  description: string;
}

/**
 * 网关控制面板
 */
export class ControlUI extends EventEmitter {
  private server: http.Server | null = null;
  private config: ControlUIConfig;
  private startTime: number = 0;
  private metrics: DashboardMetrics = {
    uptime: 0,
    activeConnections: 0,
    totalRequests: 0,
    totalErrors: 0,
    memoryUsage: 0,
    activeChannels: 0,
    registeredTools: 0,
    activePlugins: 0,
  };

  private dataProviders: Map<string, () => Promise<unknown>> = new Map();

  constructor(config: ControlUIConfig) {
    super();
    this.config = config;
  }

  /**
   * 注册数据提供者
   */
  registerDataProvider(name: string, provider: () => Promise<unknown>): void {
    this.dataProviders.set(name, provider);
  }

  /**
   * 更新指标
   */
  updateMetrics(partial: Partial<DashboardMetrics>): void {
    Object.assign(this.metrics, partial);
  }

  /**
   * 启动控制面板
   */
  async start(): Promise<void> {
    this.startTime = Date.now();

    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.emit('ui:started', {
          host: this.config.host,
          port: this.config.port,
        });
        resolve();
      });
    });
  }

  /**
   * 停止控制面板
   */
  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.emit('ui:stopped');
        resolve();
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    this.metrics.totalRequests++;

    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const path = url.pathname;

    if (this.config.authToken) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      if (
        token !== this.config.authToken &&
        url.searchParams.get('token') !== this.config.authToken
      ) {
        this.sendJson(res, 401, { error: '未授权' });
        return;
      }
    }

    try {
      switch (path) {
        case '/':
        case '/index.html':
          this.serveDashboard(res);
          break;

        case '/api/status':
          this.handleStatus(res);
          break;

        case '/api/metrics':
          this.handleMetrics(res);
          break;

        case '/api/plugins':
          this.handlePlugins(res);
          break;

        case '/api/channels':
          this.handleChannels(res);
          break;

        case '/api/tools':
          this.handleTools(res);
          break;

        default:
          this.serveStatic(path, res);
          break;
      }
    } catch (err) {
      this.metrics.totalErrors++;
      this.sendJson(res, 500, {
        error: err instanceof Error ? err.message : '内部错误',
      });
    }
  }

  /**
   * 提供仪表盘页面
   */
  private serveDashboard(res: http.ServerResponse): void {
    const pages: DashboardPage[] = [
      {
        id: 'overview',
        title: '概览',
        icon: '📊',
        description: '网关运行总览',
      },
      {
        id: 'connections',
        title: '连接',
        icon: '🔗',
        description: '活跃连接管理',
      },
      { id: 'plugins', title: '插件', icon: '🧩', description: '插件管理' },
      { id: 'channels', title: '频道', icon: '📡', description: '频道状态' },
      { id: 'tools', title: '工具', icon: '🔧', description: 'MCP 工具管理' },
      { id: 'logs', title: '日志', icon: '📋', description: '运行日志' },
    ];

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PY_APP 网关控制面板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .header { background: linear-gradient(135deg, #1e293b, #334155); padding: 20px 30px;
              border-bottom: 1px solid #475569; }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header p { color: #94a3b8; margin-top: 4px; font-size: 14px; }
    .nav { display: flex; gap: 8px; padding: 16px 30px; background: #1e293b;
           border-bottom: 1px solid #334155; flex-wrap: wrap; }
    .nav a { color: #94a3b8; text-decoration: none; padding: 8px 16px; border-radius: 6px;
             font-size: 14px; transition: all 0.2s; }
    .nav a:hover { background: #334155; color: #e2e8f0; }
    .nav a.active { background: #3b82f6; color: #fff; }
    .main { padding: 24px 30px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
             gap: 16px; margin-bottom: 24px; }
    .card { background: #1e293b; border-radius: 10px; padding: 20px; border: 1px solid #334155; }
    .card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
    .card .value { font-size: 28px; font-weight: 700; margin-top: 8px; color: #3b82f6; }
    .card .unit { font-size: 14px; color: #94a3b8; }
    .pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .page-card { background: #1e293b; border-radius: 10px; padding: 20px; border: 1px solid #334155;
                 cursor: pointer; transition: border-color 0.2s; }
    .page-card:hover { border-color: #3b82f6; }
    .page-card .icon { font-size: 32px; margin-bottom: 12px; }
    .page-card h3 { font-size: 16px; margin-bottom: 4px; }
    .page-card p { font-size: 13px; color: #94a3b8; }
    .status-bar { display: flex; gap: 20px; padding: 16px 30px; background: #1e293b;
                  border-top: 1px solid #334155; font-size: 12px; color: #64748b; }
    .status-bar .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
                       background: #22c55e; margin-right: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>PY_APP 网关控制面板</h1>
    <p>网关运行状态监控与管理</p>
  </div>
  <div class="nav">
    ${pages.map((p) => `<a href="#" class="${p.id === 'overview' ? 'active' : ''}" data-page="${p.id}">${p.icon} ${p.title}</a>`).join('')}
  </div>
  <div class="main" id="main">
    <div class="cards" id="metricsCards">
      <div class="card"><div class="label">运行时间</div><div class="value" id="uptime">-</div></div>
      <div class="card"><div class="label">活跃连接</div><div class="value" id="connections">-</div></div>
      <div class="card"><div class="label">总请求数</div><div class="value" id="requests">-</div></div>
      <div class="card"><div class="label">错误数</div><div class="value" id="errors">-</div></div>
    </div>
    <div class="pages" id="pages">
      ${pages
        .slice(1)
        .map(
          (
            p
          ) => `<div class="page-card" onclick="alert('${p.title} 页面开发中')">
        <div class="icon">${p.icon}</div><h3>${p.title}</h3><p>${p.description}</p>
      </div>`
        )
        .join('')}
    </div>
  </div>
  <div class="status-bar">
    <span><span class="dot"></span>系统运行中</span>
    <span id="serverTime">-</span>
  </div>
  <script>
    async function refreshMetrics() {
      try {
        const res = await fetch('/api/metrics');
        const data = await res.json();
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('connections').textContent = data.activeConnections;
        document.getElementById('requests').textContent = data.totalRequests;
        document.getElementById('errors').textContent = data.totalErrors;
        document.getElementById('serverTime').textContent = '更新时间: ' + new Date().toLocaleTimeString();
      } catch (e) {}
    }
    function formatUptime(seconds) {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return d + '天 ' + h + '时 ' + m + '分 ' + s + '秒';
    }
    refreshMetrics();
    setInterval(refreshMetrics, 5000);
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /**
   * 处理状态 API
   */
  private async handleStatus(res: http.ServerResponse): Promise<void> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const status = {
      running: this.server !== null,
      uptime,
      startTime: this.startTime,
      config: {
        host: this.config.host,
        port: this.config.port,
        authEnabled: !!this.config.authToken,
      },
      metrics: {
        ...this.metrics,
        uptime,
        memoryUsage: process.memoryUsage().heapUsed,
      },
    };

    this.sendJson(res, 200, status);
  }

  /**
   * 处理指标 API
   */
  private async handleMetrics(res: http.ServerResponse): Promise<void> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const metrics = {
      ...this.metrics,
      uptime,
      memoryUsage: process.memoryUsage().heapUsed,
    };

    this.sendJson(res, 200, metrics);
  }

  /**
   * 处理插件 API
   */
  private async handlePlugins(res: http.ServerResponse): Promise<void> {
    let plugins: unknown = [];

    if (this.dataProviders.has('plugins')) {
      plugins = await this.dataProviders.get('plugins')!();
    }

    this.sendJson(res, 200, { plugins });
  }

  /**
   * 处理频道 API
   */
  private async handleChannels(res: http.ServerResponse): Promise<void> {
    let channels: unknown = [];

    if (this.dataProviders.has('channels')) {
      channels = await this.dataProviders.get('channels')!();
    }

    this.sendJson(res, 200, { channels });
  }

  /**
   * 处理工具 API
   */
  private async handleTools(res: http.ServerResponse): Promise<void> {
    let tools: unknown = [];

    if (this.dataProviders.has('tools')) {
      tools = await this.dataProviders.get('tools')!();
    }

    this.sendJson(res, 200, { tools });
  }

  /**
   * 提供静态文件
   */
  private serveStatic(path: string, res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未找到' }));
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown
  ): void {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
  }

  /**
   * 获取服务状态
   */
  getStatus(): { running: boolean; host: string; port: number } {
    return {
      running: this.server !== null,
      host: this.config.host,
      port: this.config.port,
    };
  }
}
