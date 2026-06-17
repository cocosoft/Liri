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
 * handler-utils.ts — HTTP handler 通用工具函数
 *
 * 从 LocalHTTPService.ts 提取的公共辅助方法，
 * 供 handlers/ 目录下各领域 handler 文件使用。
 */

import http from 'node:http';
import path from 'node:path';

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  resolveOutputDir,
  resolveDownloadsDir,
  resolveAttachmentsDir,
  resolvePyappHome,
} from '@modules/core/paths';
import { globalWorkspaceManager } from '@modules/sandbox/WorkspaceManager';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';

const logger = new Logger({ level: LogLevel.INFO });

// ── broadcastEvent DI ────────────────────────────────────────────

/** 内部存储的 broadcastEvent 函数引用，由 setBroadcastHandler 注入 */
let broadcastEventFn: (
  event: string,
  data?: Record<string, unknown>
) => void = () => {};

/**
 * 注册 broadcastEvent 实现（由 LocalHTTPService 构造函数调用）
 *
 * @param fn - 实际的广播函数
 */
export function setBroadcastHandler(
  fn: (event: string, data?: Record<string, unknown>) => void
): void {
  broadcastEventFn = fn;
}

/**
 * 广播事件（委托给注册的实现）
 *
 * @param event - 事件名称
 * @param data - 事件数据
 */
export function broadcastEvent(
  event: string,
  data?: Record<string, unknown>
): void {
  broadcastEventFn(event, data);
}

/** compileScheduler.notifyFileChanged 的 DI 机制 */
let notifyFileChangedFn: (() => void) | null = null;

export function setNotifyFileChangedHandler(fn: (() => void) | null): void {
  notifyFileChangedFn = fn;
}

export function notifyFileChanged(): void {
  notifyFileChangedFn?.();
}

// ── Handler 上下文类型 ───────────────────────────────────────────

/**
 * handler 函数可访问的运行上下文
 * 提供发送错误响应、读取请求体、检查文件权限和广播事件的能力
 */
export interface HandlerCtx {
  sendError: (res: http.ServerResponse, err: unknown, status?: number) => void;
  readRequestBody: (req: http.IncomingMessage) => Promise<string>;
  checkFilePathPermission: (
    filePath: string,
    permission: SandboxPermission
  ) => boolean;
  broadcastEvent: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * 从 handler-utils 的独立函数创建 HandlerCtx 实例
 * 供 handler 函数使用（无需依赖类实例）
 */
export function createHandlerCtx(): HandlerCtx {
  return {
    sendError,
    readRequestBody,
    checkFilePathPermission,
    broadcastEvent,
  };
}

/**
 * 发送 JSON 格式的错误响应
 *
 * @param res - HTTP 响应对象
 * @param err - 错误信息
 * @param status - HTTP 状态码（默认 500）
 */
export function sendError(
  res: http.ServerResponse,
  err: unknown,
  status = 500
): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('API 错误', { error: message });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'api_error' } }));
}

/**
 * 检查文件路径是否在允许的白名单范围内
 *
 * @param filePath - 要检查的文件路径
 * @param permission - 需要的权限类型
 * @returns 是否允许操作
 */
export function checkFilePathPermission(
  filePath: string,
  permission: SandboxPermission
): boolean {
  const allowedDirs = [
    resolveOutputDir(),
    resolveDownloadsDir(),
    resolveAttachmentsDir(),
    resolvePyappHome(),
  ];

  const normalizedPath = path.resolve(filePath);
  const isAllowed = allowedDirs.some((dir) => {
    const normalizedDir = path.resolve(dir);
    return normalizedPath.startsWith(normalizedDir);
  });

  if (!isAllowed) {
    logger.warn(`文件路径不在白名单范围内: ${filePath}`, {
      module: 'LocalHTTPService',
      context: { permission, allowedDirs },
    });
    return false;
  }

  const activeWorkspace = globalWorkspaceManager.get('default');
  if (activeWorkspace && !activeWorkspace.hasPermission(permission)) {
    logger.warn(`工作空间缺少必要权限: ${permission}`, {
      module: 'LocalHTTPService',
      context: { workspaceId: 'default' },
    });
    return false;
  }

  return true;
}

/**
 * 读取 HTTP 请求体并返回字符串
 *
 * @param req - HTTP 请求对象
 * @returns 请求体字符串
 */
export function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}
