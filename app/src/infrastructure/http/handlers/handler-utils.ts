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

import http from 'http';
import path from 'path';

import { Logger, LogLevel } from '@modules/monitoring';
import {
  resolveOutputDir,
  resolveDownloadsDir,
  resolveAttachmentsDir,
  resolvePyappHome,
} from '@modules/core';
import { globalWorkspaceManager } from '@modules/sandbox/WorkspaceManager';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';

const logger = new Logger({
  module: 'http:handlerUtils',
  level: LogLevel.INFO,
});

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
  const { isPathWithin } = require('@modules/core/paths');
  const isAllowed = allowedDirs.some((dir) => {
    return isPathWithin(path.resolve(dir), normalizedPath);
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

/**
 * 读取 HTTP 请求体并返回原始 Buffer（用于二进制/multipart 解析）
 *
 * @param req - HTTP 请求对象
 * @returns 请求体 Buffer
 */
export function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/** multipart/form-data 解析结果 */
export interface MultipartParsedPart {
  /** 字段名称（Content-Disposition name） */
  name: string;
  /** 字段值（文件时为 Buffer，文本时为 string） */
  data: string | Buffer;
  /** 文件名（文件字段可选） */
  filename?: string;
  /** Content-Type（文件字段可选） */
  contentType?: string;
}

/**
 * 简单 multipart/form-data 解析器（无需第三方依赖）
 *
 * 从原始请求体和 Content-Type header 中提取 boundary，
 * 解析出所有表单字段。仅支持单层 flat 结构，不处理嵌套。
 *
 * @param body - 原始请求体 Buffer
 * @param contentType - Content-Type header 值（含 boundary）
 * @returns 解析出的字段列表
 */
export function parseMultipartBody(
  body: Buffer,
  contentType: string
): MultipartParsedPart[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw new Error('无法从 Content-Type 中提取 multipart boundary');
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryDelimiter = Buffer.from(`--${boundary}`);
  const endDelimiter = Buffer.from(`--${boundary}--`);

  const parts: MultipartParsedPart[] = [];
  let searchStart = 0;

  while (searchStart < body.length) {
    // 查找下一个 boundary
    const partStart = body.indexOf(boundaryDelimiter, searchStart);
    if (partStart === -1) break;

    // 跳过 boundary 行和结尾的 CRLF
    const headerStart = body.indexOf(Buffer.from('\r\n'), partStart) + 2;
    if (headerStart < 2) break;

    // 查找头部结束（空行：\r\n\r\n）
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    // 提取头部文本
    const headerSection = body
      .subarray(headerStart, headerEnd)
      .toString('utf-8');

    // 解析 Content-Disposition
    const nameMatch = /name="([^"]*)"/.exec(headerSection);
    const filenameMatch = /filename="([^"]*)"/.exec(headerSection);
    const contentTypeMatch = /^Content-Type:\s*(\S+)/im.exec(headerSection);

    // 数据从 headerEnd + 4（跳过 \r\n\r\n）开始
    const dataStart = headerEnd + 4;

    // 查找下一个 boundary 来确定结束
    const nextBoundary = body.indexOf(boundaryDelimiter, dataStart);
    if (nextBoundary === -1) break;

    // 数据结束处：减去末尾的 \r\n
    let dataEnd = nextBoundary;
    if (
      dataEnd > 2 &&
      body[dataEnd - 2] === 0x0d &&
      body[dataEnd - 1] === 0x0a
    ) {
      dataEnd -= 2;
    }

    const rawData = body.subarray(dataStart, dataEnd);

    const part: MultipartParsedPart = {
      name: nameMatch ? nameMatch[1] : '',
      data: contentTypeMatch ? rawData : rawData.toString('utf-8'),
    };

    if (filenameMatch) part.filename = filenameMatch[1];
    if (contentTypeMatch) part.contentType = contentTypeMatch[1];

    parts.push(part);

    // 检查是否是结束 boundary
    if (
      body
        .subarray(nextBoundary, nextBoundary + endDelimiter.length)
        .equals(endDelimiter)
    ) {
      break;
    }

    searchStart = nextBoundary;
  }

  return parts;
}

/**
 * P0b: 读取 HTTP 请求体（简化版 — 不 reject，静默解析）
 * 适用于 fire-and-forget 场景或不需要错误传播的 handler
 */
export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

/**
 * P0b: 发送 JSON 响应（简洁版）
 */
export function json(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
