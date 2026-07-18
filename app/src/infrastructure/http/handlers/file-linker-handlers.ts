/**
 * file-linker-handlers.ts — FileLinker API handlers
 *
 * 提供两个 HTTP 端点：
 * 1. GET /api/file/resolve-path?path=... — 验证并解析文件路径
 * 2. GET /api/file/open?path=... — 在系统默认应用中打开文件
 */

import type http from 'http';
import { existsSync, statSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import type { HandlerCtx } from './handler-utils';

/**
 * 验证文件路径是否存在，返回解析后的绝对路径
 * GET /api/file/resolve-path?path=<编码后的文件路径>
 *
 * 响应：
 *   200 { resolvedPath: string, fileName: string, exists: true }
 *   200 { exists: false, hint: string }
 */
export async function handleResolveFilePath(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const rawPath = url.searchParams.get('path') || '';

    if (!rawPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'path parameter is required' } })
      );
      return;
    }

    // 尝试解析为绝对路径
    const resolvedPath = path.isAbsolute(rawPath)
      ? path.normalize(rawPath)
      : path.resolve(process.cwd(), rawPath);

    if (!existsSync(resolvedPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          exists: false,
          resolvedPath: null,
          hint: '文件不存在',
        })
      );
      return;
    }

    const stat = statSync(resolvedPath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        resolvedPath,
        fileName: path.basename(resolvedPath),
        exists: true,
        isDirectory: stat.isDirectory(),
        size: stat.size,
      })
    );
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 在系统默认应用中打开文件
 * GET /api/file/open?path=<编码后的文件路径>
 *
 * 响应：200 { success: true }
 */
export async function handleOpenFile(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const rawPath = url.searchParams.get('path') || '';

    if (!rawPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'path parameter is required' } })
      );
      return;
    }

    const resolvedPath = path.isAbsolute(rawPath)
      ? path.normalize(rawPath)
      : path.resolve(process.cwd(), rawPath);

    if (!existsSync(resolvedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '文件不存在' } }));
      return;
    }

    // 跨平台打开文件
    const cmd =
      process.platform === 'win32'
        ? 'start'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';

    spawn(cmd, [resolvedPath], { detached: true, stdio: 'ignore' }).unref();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, path: resolvedPath }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
