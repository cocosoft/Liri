/**
 * O-02: 健康检查 API
 * 暴露 HTTP Health Endpoint (:9090/health)，供 K8s 等外部监控系统探测
 */
import http from 'http';
import os from 'os';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'daemon:healthServer',
  level: LogLevel.INFO,
});

export interface HealthCheckConfig {
  port: number;
  host: string;
  checks?: Array<{
    name: string;
    check: () => Promise<{
      healthy: boolean;
      details?: Record<string, unknown>;
    }>;
  }>;
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  port: 9090,
  host: '0.0.0.0',
};

let server: http.Server | null = null;

function collectSystemInfo(): Record<string, unknown> {
  const memUsage = process.memoryUsage();
  const cpus = os.cpus();

  return {
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuCores: cpus.length,
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    },
    timestamp: Date.now(),
  };
}

async function collectCustomChecks(
  checks: HealthCheckConfig['checks']
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  if (!checks || checks.length === 0) {
    return results;
  }

  for (const check of checks) {
    try {
      const result = await check.check();
      results[check.name] = {
        healthy: result.healthy,
        ...(result.details ? { details: result.details } : {}),
      };
    } catch (error) {
      results[check.name] = {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return results;
}

/**
 * 启动健康检查 HTTP 服务器
 */
export async function startHealthServer(
  config?: Partial<HealthCheckConfig>
): Promise<void> {
  if (server) {
    logger.warning('[O-02] 健康检查服务已在运行');
    return;
  }

  const merged: HealthCheckConfig = { ...DEFAULT_CONFIG, ...config };

  return new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        const customChecks = await collectCustomChecks(merged.checks);
        const healthData = {
          status: 'ok',
          service: 'pyapp-daemon',
          ...collectSystemInfo(),
          ...customChecks,
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
      }

      if (req.url === '/health/live' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'alive' }));
        return;
      }

      if (req.url === '/health/ready' && req.method === 'GET') {
        const customChecks = await collectCustomChecks(merged.checks);
        const allHealthy = Object.values(customChecks).every(
          (v: any) => v.healthy !== false
        );
        const status = allHealthy ? 'ready' : 'not_ready';

        res.writeHead(allHealthy ? 200 : 503, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ status, checks: customChecks }));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    server.listen(merged.port, merged.host, () => {
      logger.info(
        `[O-02] 健康检查服务已启动: http://${merged.host}:${merged.port}/health`
      );
      resolve();
    });

    server.on('error', (error) => {
      logger.error('[O-02] 健康检查服务启动失败', { error });
      server = null;
    });
  });
}

/**
 * 停止健康检查 HTTP 服务器
 */
export async function stopHealthServer(): Promise<void> {
  if (!server) {
    return;
  }

  return new Promise((resolve) => {
    server!.close(() => {
      logger.info('[O-02] 健康检查服务已停止');
      server = null;
      resolve();
    });
  });
}
