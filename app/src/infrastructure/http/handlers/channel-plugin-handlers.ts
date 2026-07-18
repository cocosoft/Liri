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
import { sendError, readRequestBody } from './handler-utils';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'infrastructure:http:handlers:channel-plugin-handlers', level: LogLevel.INFO });

// ========== ChannelPlugin Handlers ==========

/**
 * 列出所有已安装的渠道插件
 */
export async function handleListChannelPlugins(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { NpmDistributor } =
      await import('@modules/plugins/distribution/NpmDistributor');
    const distributor = new NpmDistributor();
    const installed = await distributor.listInstalled();

    const result = installed.map((p) => ({
      name: p.name,
      version: p.version,
      installed: true,
      installedAt: p.installedAt,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 安装渠道插件（通过 npm）
 */
export async function handleInstallChannelPlugin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = body ? JSON.parse(body) : {};
    const packageName = parsed.package as string | undefined;

    if (!packageName || typeof packageName !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: '"package" field is required' } })
      );
      return;
    }

    const { NpmDistributor } =
      await import('@modules/plugins/distribution/NpmDistributor');
    const distributor = new NpmDistributor();
    const result = await distributor.install(packageName);

    if (result.success) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          name: result.name,
          version: result.version,
          path: result.path,
        })
      );
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: result.error || 'Install failed',
        })
      );
    }
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 卸载渠道插件
 */
export async function handleUninstallChannelPlugin(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginName: string
): Promise<void> {
  try {
    const { NpmDistributor } =
      await import('@modules/plugins/distribution/NpmDistributor');
    const distributor = new NpmDistributor();
    await distributor.remove(pluginName);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    sendError(res, err);
  }
}
