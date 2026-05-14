/**
 * HttpRegistry 插件 HTTP 路径注册系统
 * 对标 OpenClaw 的 http-registry，允许插件注册 HTTP 路由
 * 使用系统自带的 http 模块，不引入第三方框架
 */
import http from 'node:http';
import url from 'node:url';

/**
 * HTTP 方法
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS';

/**
 * HTTP 请求上下文
 */
export interface HttpRequestContext {
  method: HttpMethod;
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  pluginName: string;
}

/**
 * HTTP 响应
 */
export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string | Record<string, unknown>;
}

/**
 * HTTP 路由处理器
 */
export interface HttpRouteHandler {
  pluginName: string;
  method: HttpMethod | HttpMethod[];
  path: string;
  description: string;
  handle(ctx: HttpRequestContext): Promise<HttpResponse> | HttpResponse;
}

/**
 * 路由注册条目
 */
export interface HttpRouteEntry {
  handler: HttpRouteHandler;
  registeredAt: number;
  enabled: boolean;
}

/**
 * HTTP 路径注册表
 */
export class HttpRegistry {
  private routes: HttpRouteEntry[] = [];

  /**
   * 注册 HTTP 路由
   */
  register(handler: HttpRouteHandler): boolean {
    const exists = this.routes.some(
      (r) =>
        r.handler.pluginName === handler.pluginName &&
        r.handler.path === handler.path
    );

    if (exists) {
      return false;
    }

    this.routes.push({
      handler,
      registeredAt: Date.now(),
      enabled: true,
    });

    return true;
  }

  /**
   * 注销路由
   */
  unregister(pluginName: string, path: string): boolean {
    const index = this.routes.findIndex(
      (r) => r.handler.pluginName === pluginName && r.handler.path === path
    );

    if (index === -1) {
      return false;
    }

    this.routes.splice(index, 1);
    return true;
  }

  /**
   * 按插件名注销所有路由
   */
  unregisterByPlugin(pluginName: string): number {
    const before = this.routes.length;
    this.routes = this.routes.filter(
      (r) => r.handler.pluginName !== pluginName
    );
    return before - this.routes.length;
  }

  /**
   * 查找匹配的路由
   */
  find(method: HttpMethod, pathname: string): HttpRouteHandler | undefined {
    const matches = this.routes.filter((r) => {
      if (!r.enabled) {
        return false;
      }

      const methods = Array.isArray(r.handler.method)
        ? r.handler.method
        : [r.handler.method];

      if (!methods.includes(method)) {
        return false;
      }

      return matchPath(r.handler.path, pathname);
    });

    matches.sort((a, b) => b.handler.path.length - a.handler.path.length);

    return matches[0]?.handler;
  }

  /**
   * 创建请求处理器（用于 http.createServer）
   */
  createRequestHandler(): http.RequestListener {
    return async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const parsedUrl = url.parse(req.url || '/', true);
      const method = (req.method || 'GET').toUpperCase() as HttpMethod;
      const pathname = parsedUrl.pathname || '/';
      const query = parsedUrl.query as Record<string, string>;

      const handler = this.find(method, pathname);

      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
        return;
      }

      let body: unknown = null;

      if (
        req.method === 'POST' ||
        req.method === 'PUT' ||
        req.method === 'PATCH'
      ) {
        body = await parseBody(req);
      }

      const ctx: HttpRequestContext = {
        method,
        path: pathname,
        query,
        headers: req.headers,
        body,
        pluginName: handler.pluginName,
      };

      try {
        const result = await handler.handle(ctx);
        const statusCode = result.statusCode || 200;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...result.headers,
        };

        res.writeHead(statusCode, headers);

        if (typeof result.body === 'string') {
          res.end(result.body);
        } else {
          res.end(JSON.stringify(result.body));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', message }));
      }
    };
  }

  /**
   * 获取所有路由
   */
  getAll(): HttpRouteEntry[] {
    return [...this.routes];
  }

  /**
   * 按插件名获取路由
   */
  getByPlugin(pluginName: string): HttpRouteEntry[] {
    return this.routes.filter((r) => r.handler.pluginName === pluginName);
  }

  /**
   * 启用/禁用路由
   */
  setEnabled(pluginName: string, path: string, enabled: boolean): boolean {
    const route = this.routes.find(
      (r) => r.handler.pluginName === pluginName && r.handler.path === path
    );

    if (!route) {
      return false;
    }

    route.enabled = enabled;
    return true;
  }

  /**
   * 获取路由统计
   */
  getStats(): {
    total: number;
    enabled: number;
    byPlugin: Record<string, number>;
  } {
    let enabled = 0;
    const byPlugin: Record<string, number> = {};

    for (const route of this.routes) {
      if (route.enabled) {
        enabled++;
      }
      byPlugin[route.handler.pluginName] =
        (byPlugin[route.handler.pluginName] || 0) + 1;
    }

    return {
      total: this.routes.length,
      enabled,
      byPlugin,
    };
  }
}

/**
 * 路径匹配（支持通配符 *）
 */
function matchPath(pattern: string, pathname: string): boolean {
  if (pattern === pathname) {
    return true;
  }

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return pathname.startsWith(prefix);
  }

  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) {
    return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] !== pathParts[i] && patternParts[i] !== ':param') {
      return false;
    }
  }

  return true;
}

/**
 * 解析请求体
 */
function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');

      if (!raw) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });

    req.on('error', reject);
  });
}

export const httpRegistry = new HttpRegistry();
