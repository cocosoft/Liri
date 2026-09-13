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
import type { Dirent } from 'fs';
import path from 'path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
import { logSecurityBlock } from '../../../security/SecurityAuditLogger.js';
const logger = getLogger('infrastructure:http:handlers:files-handlers');

// 已注册的存储分区别名 → 绝对路径解析函数（延迟动态 import）
function resolveStorePath(rawPath: string): string {
  const { isAbsolute, resolve, join } = require('path');

  // 空路径或 "." 表示 LIRI_HOME（~/.pyapp/），展示全目录
  if (!rawPath || rawPath === '.') {
    // O42（2026-09-13）：统一走 core/paths 唯一入口（此前额外兼容读遗留名 PYAPP_HOME）
    return require('@modules/core/paths').resolvePyappHome();
  }

  const firstSegment = rawPath.split(/[/\\]/).filter(Boolean)[0] || rawPath;

  // 尝试从环境变量中获取已知目录的绝对路径
  const ENV_MAP: Record<string, string | undefined> = {
    output: process.env.OUTPUT_DIR,
    downloads: process.env.DOWNLOADS_DIR,
    attachments:
      process.env.ATTACHMENTS_DIR ||
      (() => {
        // 从已知解析函数回退
        try {
          const { resolveAttachmentsDir } = require('@modules/core/paths');
          return resolveAttachmentsDir();
        } catch {
          return undefined;
        }
      })(),
    home: require('@modules/core/paths').resolvePyappHome(),
  };

  const base = ENV_MAP[firstSegment];
  if (base) {
    const rest = rawPath.slice(firstSegment.length).replace(/^[/\\]/, '');
    const resolved = rest ? join(base, rest) : base;
    // 安全校验：确保 path.join 没有被跨盘符绝对路径覆盖（BUG02修复）
    const { isPathWithin } = require('@modules/core/paths');
    const resolvedBase = base;
    if (!isPathWithin(resolvedBase, resolved)) {
      // 2-1（2026-09-03）：越权拦截统一审计
      logSecurityBlock({
        kind: 'unauthorized_path',
        requestedPath: rawPath,
        detail: 'resolveStorePath: join 结果越出已知目录分区',
      });
      logger.warn('resolveStorePath: 路径越权被拦截', {
        rawPath,
        resolved,
        base,
      });
      return base; // 回退到安全基路径
    }
    return resolved;
  }
  // BUG-B 修复：未知前缀的绝对路径拒绝访问，防止目录列表越权
  const fallback = isAbsolute(rawPath) ? rawPath : resolve(rawPath);
  // 仅允许 LIRI_HOME 下的路径（~/.pyapp/）
  const home = require('@modules/core/paths').resolvePyappHome() as string;
  if (home) {
    const { isPathWithin } = require('@modules/core/paths');
    if (!isPathWithin(home, fallback)) {
      // 2-1（2026-09-03）：越权拦截统一审计
      logSecurityBlock({
        kind: 'unauthorized_path',
        requestedPath: rawPath,
        detail: 'resolveStorePath: 未知前缀路径不在 LIRI_HOME 下',
      });
      logger.warn('resolveStorePath: 未知前缀路径拒绝访问', {
        rawPath,
        fallback,
      });
      return home;
    }
  }
  return fallback;
}

/**
 * P1-1（2026-09-07）：构建条目逻辑相对路径（导航用，替代绝对路径回传）。
 * relPath 为请求相对路径的 posix 延续：rawPath=''/'.' → name；rawPath='attachments'
 * → 'attachments/name'。与 resolveStorePath 的首段分区语义一致，前端导航回传
 * resolveStorePath(relPath) 可安全解析（不会触发绝对路径越权拦截/回退）。
 * @param rawPath 请求 path 参数（'' | '.' | 相对分区路径）
 * @param name 条目名（Windows 下不含 / 或 \）
 */
export function buildEntryRelPath(rawPath: string, name: string): string {
  const base =
    !rawPath || rawPath === '.' ? '' : rawPath.replace(/^[/\\]+|[/\\]+$/g, '');
  return base ? `${base}/${name}` : name;
}

/**
 * 处理文件系统目录列表请求
 * GET /v1/files/list?path=output
 * 列出指定目录下的文件和子目录
 */
export async function handleFileList(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const rawPath = url.searchParams.get('path') || '.';
    const absPath = resolveStorePath(rawPath);

    const { readdirSync, statSync, existsSync } = require('fs');
    if (!existsSync(absPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }

    const names = readdirSync(absPath, { withFileTypes: true });
    const entries = names.map((dirent: Dirent) => {
      const fullPath = path.join(absPath, dirent.name);
      let size: number | undefined;
      let modifiedAt: number | undefined;
      try {
        const stat = statSync(fullPath);
        size = stat.size;
        modifiedAt = stat.mtimeMs;
      } catch (err) {
        // 权限不足时跳过 stat

        handleError(err, {
          module: 'infrastructure:http:handlers:files-handlers',
          action: 'permissionDeniedStat',
        });
      }
      return {
        name: dirent.name,
        path: fullPath,
        // P1-1：逻辑相对路径（导航回传用；读/预览仍走绝对 path）
        relPath: buildEntryRelPath(rawPath, dirent.name),
        type: dirent.isDirectory() ? 'directory' : 'file',
        size,
        modified_at: modifiedAt ? Math.floor(modifiedAt) : undefined,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 图片扩展名集合
 */
const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
]);

/**
 * 二进制文件扩展名集合（不可作为文本预览）
 */
const BINARY_EXTS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xls',
  '.xlsx',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.mkv',
  '.zip',
  '.rar',
  '.7z',
  '.gz',
  '.tar',
  '.bz2',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.ico',
  '.icns',
  '.tiff',
  '.tif',
  '.psd',
  '.ai',
  '.eps',
]);

/**
 * 根据扩展名获取 MIME 类型
 */
function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 文件内容读取响应
 */
interface FileReadResponse {
  content: string;
  isBase64: boolean;
  mimeType: string;
  truncated?: boolean;
}

/**
 * 最大预览文件大小（5MB），超过此大小的文件提示过大而非直接读取
 */
const MAX_PREVIEW_SIZE = 5 * 1024 * 1024;

/**
 * 处理文件读取请求
 * GET /v1/files/read?path=output/xxx.md
 * 读取指定文件内容并返回
 * - 文本文件：以 UTF-8 读取，直接返回内容
 * - 图片文件：以 base64 编码，返回 data URL
 * - 其他二进制文件：返回不支持预览提示
 * - 超大文件：返回文件过大提示
 */
export async function handleFileRead(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const rawPath = url.searchParams.get('path') || '';
    if (!rawPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'path is required' } }));
      return;
    }

    const absPath = resolveStorePath(rawPath);

    const { readFileSync, existsSync, statSync } = require('fs');
    if (!existsSync(absPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '文件不存在' } }));
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    const stat = statSync(absPath);

    // 检查文件大小，超过限制则提示
    if (stat.size > MAX_PREVIEW_SIZE) {
      const resp: FileReadResponse = {
        content: `文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），预览仅支持 ${MAX_PREVIEW_SIZE / 1024 / 1024} MB 以内的文件`,
        isBase64: false,
        mimeType: '',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
      return;
    }

    // 图片文件：读取为 base64 并返回 data URL
    if (IMAGE_EXTS.has(ext)) {
      const buffer = readFileSync(absPath);
      const mimeType = getMimeType(ext);
      const base64 = buffer.toString('base64');
      const resp: FileReadResponse = {
        content: `data:${mimeType};base64,${base64}`,
        isBase64: true,
        mimeType,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
      return;
    }

    // 其他二进制文件：返回不支持预览提示
    if (BINARY_EXTS.has(ext)) {
      const resp: FileReadResponse = {
        content: `文件类型 "${ext}" 暂不支持在线预览，请在系统中打开查看`,
        isBase64: false,
        mimeType: '',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
      return;
    }

    // 文本文件：以 UTF-8 读取
    const content = readFileSync(absPath, 'utf-8');
    const resp: FileReadResponse = {
      content,
      isBase64: false,
      mimeType: 'text/plain',
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resp));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

// ========== Files Handlers ==========

// ⚠️ 2026-09-07（P0-3）：handleFileUpload / handleConvertFile / handleDetectFileType /
// handleSendFileToAI 的活跃实现已收敛至 ../file-upload-handlers（路由唯一引用源）。
// 旧副本已删除，避免双份维护漂移。

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
    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');

    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const query: Record<string, unknown> = {};
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
      offset: (page - 1) * Math.min(pageSize, 100),
      limit: Math.min(pageSize, 100),
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
    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const { DiskSpaceMonitor } =
      await import('@modules/core/delivery/monitor/DiskSpaceMonitor');
    const { resolvePyappHome } = await import('@modules/core/paths');
    const { existsSync } = await import('fs');

    const checks: Record<
      string,
      { status: string; message: string; value?: unknown }
    > = {};

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
      const mainDisk =
        disks.find((d) => pyappDir.startsWith(d.drive)) || disks[0];

      if (mainDisk) {
        const freeGB =
          Math.round((mainDisk.freeBytes / (1024 * 1024 * 1024)) * 100) / 100;
        const usagePercent = Math.round(mainDisk.usagePercent * 100) / 100;

        checks.disk = {
          status:
            usagePercent > 95
              ? 'critical'
              : usagePercent > 85
                ? 'warning'
                : 'ok',
          message: `磁盘使用率 ${usagePercent}%`,
          value: {
            drive: mainDisk.drive,
            totalGB:
              Math.round((mainDisk.totalBytes / (1024 * 1024 * 1024)) * 100) /
              100,
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
      message: existsSync(inboundDir)
        ? 'Inbound 目录存在'
        : 'Inbound 目录不存在',
    };

    const allOk = Object.values(checks).every((c) => c.status === 'ok');
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

    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const record = await registry.getFileDetail(fileId);
    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'File not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(record));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * 处理文件搜索请求
 *
 * GET /v1/files/registry/search?q=xxx&limit=20
 * GET /v1/files/registry/search?source=upload&store_zone=inbound（无 q 时回退为列表）
 *
 * 返回格式：{ items: FileRecord[], total: number }（裸对象；2026-09-07 P0-1 去 data 包装）
 * 前端 FileSearchResult 期望 items/total 字段
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

    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    if (q) {
      // 有搜索词 → FTS5 全文搜索
      const results = await registry.searchFiles(q, Math.min(limit, 50));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: results, total: results.length }));
    } else {
      // 无搜索词 → 按筛选条件列表（来源/分区/日期）
      const source = url.searchParams.get('source') || undefined;
      const storeZone = url.searchParams.get('store_zone') || undefined;
      const startDate = url.searchParams.get('start_date') || undefined;
      const endDate = url.searchParams.get('end_date') || undefined;
      const cursor = parseInt(url.searchParams.get('cursor') || '0', 10);

      const listResult = await registry.listFiles({
        source,
        storeZone,
        startDate,
        endDate,
        offset: isNaN(cursor) ? 0 : cursor,
        limit: Math.min(limit, 100),
      });

      // P2-1（2026-09-07）：offset 分页——返回是否还有更多，供前端"加载更多"判定
      const offset = isNaN(cursor) ? 0 : cursor;
      const hasMore = listResult.files.length + offset < listResult.total;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          items: listResult.files,
          total: listResult.total,
          hasMore,
        })
      );
    }
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
    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    const stats = await registry.getStats();

    // L3（2026-09-07）：内部统计字段名 → 前端 FileStats 契约名映射
    // （todayCount→todayInbound、dedupSavedSize→dedupSize）；dedup 已改 DB 持久化口径
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        totalFiles: stats.totalFiles,
        totalSize: stats.totalSize,
        todayInbound: stats.todayCount,
        dedupSaved: stats.dedupSaved,
        dedupSize: stats.dedupSavedSize,
      })
    );
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
      res.end(
        JSON.stringify({
          error: { message: 'fileIds is required (comma-separated)' },
        })
      );
      return;
    }

    const fileIds = fileIdsParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    await registry.softDelete(fileIds);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deletedCount: fileIds.length }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
