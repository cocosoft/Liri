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

import type http from 'node:http';
import path from 'node:path';
import type { HandlerCtx } from './handler-utils';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { createChatManager } from '@modules/chat/ChatManager';
import { readRequestBody } from './handler-utils';
import { attachmentManager, AttachmentSource } from '@modules/components/attachments';

// ========== Files Handlers ==========

export async function handleFileUpload(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { filename, data } = JSON.parse(body);
      if (!filename || !data) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'filename and data are required' },
          })
        );
        return;
      }
      const buffer = Buffer.from(data, 'base64');
      const safeName = path.basename(filename);
      // 使用 AttachmentManager 保存到用户附件目录（第三层：~/.pyapp/attachments/）
      const attachment = attachmentManager.saveAttachment(
        safeName,
        buffer,
        'file',
        'application/octet-stream',
        AttachmentSource.SESSION
      );

      // 同步注册到 FileRegistry（异步执行，不阻塞响应）
      registerUploadToFileRegistry(safeName, buffer, attachment.path).catch(() => {});

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: attachment.path, size: buffer.length }));
    } catch (err) {
    }
  }

  /**
   * 处理文件格式转换请求
   */
export async function handleConvertFile(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { filePath, outputFormat, options } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const result = await coreAPI.convertFile({
        filePath,
        outputFormat,
        options,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
    }
  }

  /**
   * 处理文件类型检测请求
   */
export async function handleDetectFileType(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { filePath } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const result = await coreAPI.detectFileType(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
    }
  }

  /**
   * 处理发送文件给AI分析请求
   * POST /v1/files/send-to-ai
   * 读取文件内容，将其作为用户消息发送给AI
   */
export async function handleSendFileToAI(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { filePath } = JSON.parse(body);

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
        return;
      }

      // 沙箱权限检查
      if (!ctx.checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied: file path not in whitelist' } }));
        return;
      }

      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { basename } = await import('node:path');

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File not found' } }));
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      const fileName = basename(filePath);

      // 将文件内容作为消息发送给AI
      const chatManager = createChatManager();

      const message = `请分析以下文件内容（文件名: ${fileName}）:\n\n${content}`;
      await chatManager.sendMessage(message);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, fileName, size: content.length }));
    } catch (err) {
    }
  }

/**
 * 将 HTTP 上传的文件注册到 FileRegistry
 * 异步函数，由调用方自行处理错误
 */
async function registerUploadToFileRegistry(
  fileName: string,
  buffer: Buffer,
  savedPath: string
): Promise<void> {
  try {
    const { FileRegistry } = await import('@modules/services/file/FileRegistry');
    const { FileSource } = await import('@modules/services/file/types');

    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    await registry.registerFile({
      originalName: fileName,
      content: buffer,
      source: FileSource.UPLOAD,
      sourceId: 'http_upload',
      mimeType: 'application/octet-stream',
      description: `HTTP 上传文件: ${fileName}`,
      storeZone: 'inbound',
    });
  } catch {
    // 静默失败，不影响 HTTP 响应
  }
}

// ========== File Registry Handlers ==========

/**
 * 处理文件列表查询请求
 * GET /v1/files/registry/list
 * 查询参数：page, pageSize, source, storeZone, mediaType, keyword, sortBy, sortOrder
 */
export async function handleFileRegistryList(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const { FileRegistry } = await import('@modules/services/file/FileRegistry');

    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const query: Record<string, any> = {};
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const source = url.searchParams.get('source');
    const storeZone = url.searchParams.get('storeZone');
    const mediaType = url.searchParams.get('mediaType');
    const keyword = url.searchParams.get('keyword');
    const sortBy = url.searchParams.get('sortBy') || 'created_at';
    const sortOrder = url.searchParams.get('sortOrder') || 'desc';

    if (source) query.source = source;
    if (storeZone) query.storeZone = storeZone;
    if (mediaType) query.mediaType = mediaType;
    if (keyword) query.keyword = keyword;
    query.sortBy = sortBy;
    query.sortOrder = sortOrder;

    const result = await registry.listFiles({
      page,
      pageSize: Math.min(pageSize, 100),
      ...query,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理文件健康检查请求
 * GET /v1/files/health
 * 检查：DB 连通性 + 磁盘空间
 */
export async function handleFileHealth(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { FileRegistry } = await import('@modules/services/file/FileRegistry');
    const { DiskSpaceMonitor } = await import('@modules/core/delivery/monitor/DiskSpaceMonitor');
    const { resolvePyappHome } = await import('@modules/core/paths');
    const { existsSync } = await import('fs');

    const checks: Record<string, { status: string; message: string; value?: unknown }> = {};

    // 1. DB 连通性检查
    try {
      const registry = FileRegistry.getInstance();
      await registry.initDatabase();
      const stats = await registry.getStats();
      checks.database = {
        status: 'ok',
        message: '数据库连接正常',
        value: { totalFiles: stats.totalFiles },
      };
    } catch (err) {
      checks.database = {
        status: 'error',
        message: `数据库连接失败: ${(err as Error).message}`,
      };
    }

    // 2. 磁盘空间检查
    try {
      const monitor = new DiskSpaceMonitor();
      const disks = monitor.check();
      const pyappDir = resolvePyappHome();
      const mainDisk = disks.find(d => pyappDir.startsWith(d.drive)) || disks[0];

      if (mainDisk) {
        const freeGB = Math.round((mainDisk.freeBytes / (1024 * 1024 * 1024)) * 100) / 100;
        const usagePercent = Math.round(mainDisk.usagePercent * 100) / 100;

        checks.disk = {
          status: usagePercent > 95 ? 'critical' : usagePercent > 85 ? 'warning' : 'ok',
          message: `磁盘使用率 ${usagePercent}%`,
          value: {
            drive: mainDisk.drive,
            totalGB: Math.round((mainDisk.totalBytes / (1024 * 1024 * 1024)) * 100) / 100,
            freeGB,
            usagePercent,
          },
        };
      } else {
        checks.disk = { status: 'unknown', message: '无法获取磁盘信息' };
      }
    } catch (err) {
      checks.disk = {
        status: 'error',
        message: `磁盘检查失败: ${(err as Error).message}`,
      };
    }

    // 3. Inbound 目录检查
    const inboundDir = resolvePyappHome() + '/knowledge/raw/inbound';
    checks.inboundDirectory = {
      status: existsSync(inboundDir) ? 'ok' : 'warning',
      message: existsSync(inboundDir) ? 'Inbound 目录存在' : 'Inbound 目录不存在',
    };

    const allOk = Object.values(checks).every(c => c.status === 'ok');
    res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: allOk ? 'healthy' : 'degraded', checks }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理文件详情查询请求
 * GET /v1/files/registry/detail?fileId=xxx
 */
export async function handleFileRegistryDetail(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fileId is required' } }));
      return;
    }

    const { FileRegistry } = await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const record = await registry.getFileDetail(fileId);
    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'File not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: record }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理文件搜索请求
 * GET /v1/files/registry/search?q=xxx&limit=20
 */
export async function handleFileRegistrySearch(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const q = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'q (search query) is required' } }));
      return;
    }

    const { FileRegistry } = await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const results = await registry.searchFiles(q, Math.min(limit, 50));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: results, total: results.length }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理文件统计请求
 * GET /v1/files/registry/stats
 */
export async function handleFileRegistryStats(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { FileRegistry } = await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const stats = await registry.getStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: stats }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理文件软删除请求
 * DELETE /v1/files/registry/delete?fileIds=xxx,yyy
 */
export async function handleFileRegistryDelete(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const fileIdsParam = url.searchParams.get('fileIds');
    if (!fileIdsParam) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fileIds is required (comma-separated)' } }));
      return;
    }

    const fileIds = fileIdsParam.split(',').map(id => id.trim()).filter(Boolean);

    const { FileRegistry } = await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    await registry.softDelete(fileIds);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deletedCount: fileIds.length }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
