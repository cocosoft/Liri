/**
 * Image Handlers
 * 图片静态文件服务 + 图片列表 API + 图片删除 API
 *
 * 端点：
 *   GET    /v1/images/static/*  — 提供图片文件
 *   GET    /v1/images/list       — 列出所有已生成的图片
 *   POST   /v1/images/upload     — 上传图片
 *   DELETE /v1/images/delete     — 删除图片（按路径）
 */

import type http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { HandlerCtx } from './handler-utils';
import { readRawBody, parseMultipartBody } from './handler-utils';
import { handleError } from '@modules/error';
import {
  resolveOutputDir,
  resolveMediaDir,
  resolveAttachmentsDir,
} from '@modules/core/paths';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure:http:handlers:image-handlers',
  level: LogLevel.INFO,
});

/** 图片输出根目录（上传） */
const IMAGES_ROOT = path.join(resolveOutputDir(), 'images');

/** 图片媒体根目录（AI 生成持久化） */
const MEDIA_IMAGES_ROOT = path.join(resolveMediaDir(), 'images');

/** 附件根目录（文件上传保存位置） */
const ATTACHMENTS_ROOT = resolveAttachmentsDir();

/** 所有需要扫描的图片目录 */
const IMAGE_ROOTS = [IMAGES_ROOT, MEDIA_IMAGES_ROOT, ATTACHMENTS_ROOT];

/** MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/** 文件签名（magic bytes）映射：扩展名 → 签名字节数组 */
const MAGIC_BYTES: Record<
  string,
  Array<{ offset: number; bytes: number[] }>
> = {
  '.png': [
    { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  '.jpg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  '.jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  '.gif': [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  '.webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  '.bmp': [{ offset: 0, bytes: [0x42, 0x4d] }],
  '.svg': [{ offset: 0, bytes: [0x3c] }],
};

/** 上传速率限制：每分钟最大上传次数 */
const UPLOAD_RATE_LIMIT = 20;
/** 速率限制窗口（毫秒） */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** 上传速率追踪：sessionId → 上传时间戳数组 */
const uploadRateTracker = new Map<string, number[]>();

/** 清理过期的速率记录 */
function pruneRateTracker() {
  const now = Date.now();
  const threshold = now - RATE_LIMIT_WINDOW_MS;
  for (const [sessionId, timestamps] of uploadRateTracker) {
    const valid = timestamps.filter((t) => t > threshold);
    if (valid.length === 0) {
      uploadRateTracker.delete(sessionId);
    } else {
      uploadRateTracker.set(sessionId, valid);
    }
  }
}

/** 检查 magic bytes 是否匹配 */
function checkMagicBytes(buffer: Buffer, ext: string): boolean {
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return true; // 无签名定义则放行

  return signatures.every((sig) => {
    if (buffer.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
  });
}

/**
 * 获取文件的 MIME 类型
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * 检查指定路径是否在任意安全根目录内
 */
function isInAnySafeRoot(absolutePath: string): boolean {
  for (const root of IMAGE_ROOTS) {
    if (absolutePath.startsWith(root)) return true;
  }
  return false;
}

/**
 * 路径遍历安全检查 — 检查请求路径是否在任意根目录内
 * 支持两种格式：相对路径（含 media/attachments/ 前缀）和绝对路径
 */
function isAnyRootSafe(requestedPath: string): boolean {
  // 绝对路径：直接检查是否在安全根目录内
  if (path.isAbsolute(requestedPath)) {
    return isInAnySafeRoot(path.resolve(requestedPath));
  }

  // 相对路径：去前缀后检查
  let resolvedPath: string;
  if (requestedPath.startsWith('media/')) {
    const subPath = requestedPath.slice('media/'.length);
    resolvedPath = path.resolve(MEDIA_IMAGES_ROOT, subPath);
    return resolvedPath.startsWith(MEDIA_IMAGES_ROOT);
  }
  if (requestedPath.startsWith('attachments/')) {
    const subPath = requestedPath.slice('attachments/'.length);
    resolvedPath = path.resolve(ATTACHMENTS_ROOT, subPath);
    return resolvedPath.startsWith(ATTACHMENTS_ROOT);
  }
  resolvedPath = path.resolve(IMAGES_ROOT, requestedPath);
  return resolvedPath.startsWith(IMAGES_ROOT);
}

/**
 * 解析请求路径到完整文件路径
 * 支持两种格式：相对路径（含 media/attachments/ 前缀）和绝对路径
 */
function resolveFullPath(requestedPath: string): string | null {
  // 绝对路径：直接返回（经安全检查后）
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    if (isInAnySafeRoot(resolved)) return resolved;
    return null;
  }

  // 相对路径：拼接对应根目录
  if (requestedPath.startsWith('media/')) {
    const subPath = requestedPath.slice('media/'.length);
    const p = path.resolve(MEDIA_IMAGES_ROOT, subPath);
    if (!p.startsWith(MEDIA_IMAGES_ROOT)) return null;
    return p;
  }
  if (requestedPath.startsWith('attachments/')) {
    const subPath = requestedPath.slice('attachments/'.length);
    const p = path.resolve(ATTACHMENTS_ROOT, subPath);
    if (!p.startsWith(ATTACHMENTS_ROOT)) return null;
    return p;
  }
  const p = path.resolve(IMAGES_ROOT, requestedPath);
  if (!p.startsWith(IMAGES_ROOT)) return null;
  return p;
}

/**
 * 递归遍历目录收集图片文件路径
 */
function collectImageFiles(
  dir: string,
  basePath: string,
  files: string[]
): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectImageFiles(fullPath, basePath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (MIME_MAP[ext]) {
          // 存储相对于 IMAGES_ROOT 的路径
          const relativePath = path.relative(basePath, fullPath);
          files.push(relativePath);
        }
      }
    }
  } catch (err) {
    // 目录不存在或不可读，忽略

    logger.debug('Operation skipped', {
      context: '目录不存在或不可读，忽略',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * GET /v1/images/static/*
 * 提供图片静态文件服务
 *
 * URL 格式：/v1/images/static/YYYY-MM-DD/img_xxx.png
 * 或带前缀：/v1/images/static/media/xxx 或 /v1/images/static/attachments/xxx
 * 安全：仅允许 IMAGE_ROOTS 内的路径，拒绝路径遍历
 */
export async function handleImageStatic(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string
): Promise<void> {
  try {
    // 安全检查
    if (!isAnyRootSafe(filePath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = resolveFullPath(filePath);
    if (!fullPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }

    // 文件存在性检查
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }

    // 读取并返回文件
    const buffer = fs.readFileSync(fullPath);
    const mimeType = getMimeType(fullPath);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buffer);
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'image_static' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * 读取图片文件的宽高（不依赖第三方库）
 * 支持 PNG、JPEG、GIF 格式
 */
function readImageDimensions(
  filePath: string
): { width: number; height: number } | null {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 24) return null;

    // PNG: 8 字节签名后，第 16-23 字节是 IHDR 中的宽高
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }

    // JPEG: 扫描 SOF0/SOF2 marker (0xFF 0xC0 或 0xFF 0xC2)
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height };
        }
        offset += buf.readUInt16BE(offset + 2) + 2;
      }
      return null;
    }

    // GIF: 偏移 6-9 是宽高（little-endian）
    if (
      buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x38
    ) {
      const width = buf.readUInt16LE(6);
      const height = buf.readUInt16LE(8);
      return { width, height };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * GET /v1/images/metadata?path=xxx
 * 返回图片文件的元数据（Phase 3.4: 信息面板）
 */
export async function handleImageMetadata(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const rawUrl = req.url || '/';
    const urlObj = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const filePath = urlObj.searchParams.get('path');

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }

    if (!isAnyRootSafe(filePath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = resolveFullPath(filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }

    const stat = fs.statSync(fullPath);
    const dimensions = readImageDimensions(fullPath);
    const ext = path.extname(fullPath).toLowerCase().replace('.', '');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        path: fullPath,
        size: stat.size,
        format: ext,
        width: dimensions?.width || null,
        height: dimensions?.height || null,
        createdAt: stat.birthtimeMs,
        modifiedAt: stat.mtimeMs,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'image_metadata' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * POST /v1/images/upload
 * 上传图片（multipart/form-data，字段名 "file"）
 */
export async function handleImageUpload(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
      return;
    }

    // 速率限制：基于客户端 IP，每分钟最多 20 次上传
    pruneRateTracker();
    const clientId =
      (req.headers['x-session-id'] as string) ||
      req.socket?.remoteAddress ||
      'unknown';
    const timestamps = uploadRateTracker.get(clientId) || [];
    const now = Date.now();
    const recentUploads = timestamps.filter(
      (t) => t > now - RATE_LIMIT_WINDOW_MS
    );
    if (recentUploads.length >= UPLOAD_RATE_LIMIT) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      });
      res.end(
        JSON.stringify({ error: 'Too many uploads. Please try again later.' })
      );
      return;
    }

    const body = await readRawBody(req);
    const parts = parseMultipartBody(body, contentType);
    const filePart = parts.find((p) => p.name === 'file' && p.filename);

    if (
      !filePart ||
      !(filePart.data instanceof Buffer) ||
      filePart.data.length === 0
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No file uploaded or file is empty' }));
      return;
    }

    // 安全校验：仅允许图片类型
    const ext = path.extname(filePart.filename || '.png').toLowerCase();
    const allowedExts = [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.bmp',
      '.svg',
    ];
    if (!allowedExts.includes(ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unsupported file type: ${ext}` }));
      return;
    }

    // magic bytes 校验：确保文件内容与扩展名一致
    if (!checkMagicBytes(filePart.data, ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `File content does not match extension ${ext}`,
        })
      );
      return;
    }

    // 记录上传（更新速率追踪）
    recentUploads.push(now);
    uploadRateTracker.set(clientId, recentUploads);

    // 保存到 output/images/YYYY-MM-DD/
    const today = new Date().toISOString().slice(0, 10);
    const targetDir = path.join(IMAGES_ROOT, today);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeName = `${randomUUID().slice(0, 8)}${ext}`;
    const outputPath = path.join(targetDir, safeName);
    fs.writeFileSync(outputPath, filePart.data);

    // 构建相对于 IMAGES_ROOT 的路径（用于 HTTP URL）
    const relativePath = path
      .relative(IMAGES_ROOT, outputPath)
      .replace(/\\/g, '/');

    // 返回绝对路径，确保 ChatManager / image_analysis 等下游能正确读取文件
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        path: outputPath,
        url: `/v1/images/static/${relativePath}`,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'image_upload' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * GET /v1/images/list?page=1&pageSize=50
 * 列出已生成的图片文件（支持分页）
 * 同时扫描 output/images/（上传）、media/images/（AI 生成持久化）和 attachments/（文件上传）
 */
export async function handleImageList(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const rawUrl = req.url || '/';
    const urlObj = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const page = Math.max(
      1,
      parseInt(urlObj.searchParams.get('page') || '1', 10)
    );
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(urlObj.searchParams.get('pageSize') || '50', 10))
    );

    // 收集所有图片根目录下的文件（记录绝对路径用于工具调用，相对路径用于 URL 构造）
    const files: Array<{
      relativePath: string;
      absolutePath: string;
      urlPrefix: string;
    }> = [];

    for (const root of IMAGE_ROOTS) {
      if (!fs.existsSync(root)) continue;

      let urlPrefix = '';
      if (root === MEDIA_IMAGES_ROOT) {
        urlPrefix = 'media/';
      } else if (root === ATTACHMENTS_ROOT) {
        urlPrefix = 'attachments/';
      }

      const localFiles: string[] = [];
      collectImageFiles(root, root, localFiles);

      for (const f of localFiles) {
        const displayPath = urlPrefix
          ? `${urlPrefix}${f.replace(/\\/g, '/')}`
          : f.replace(/\\/g, '/');
        files.push({
          relativePath: displayPath,
          absolutePath: path.join(root, f),
          urlPrefix,
        });
      }
    }

    // 按路径排序
    files.sort((a, b) => b.relativePath.localeCompare(a.relativePath));

    const total = files.length;
    const startIdx = (page - 1) * pageSize;
    const paged = files.slice(startIdx, startIdx + pageSize);

    const images = paged.map((f) => ({
      path: f.absolutePath,
      url: `/v1/images/static/${f.relativePath}`,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        images,
        total,
        page,
        pageSize,
        hasMore: startIdx + pageSize < total,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'image_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * DELETE /v1/images/delete?path=media/YYYY-MM-DD/img.png
 * 删除指定路径的图片文件（安全校验：仅允许在 IMAGE_ROOTS 内的路径）
 */
export async function handleImageDelete(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const rawUrl = req.url || '/';
    const urlObj = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const filePath = urlObj.searchParams.get('path');

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }

    // 安全检查：仅允许在已知根目录内
    if (!isAnyRootSafe(filePath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = resolveFullPath(filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }

    // 安全校验：必须是文件，不能是目录
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot delete directory' }));
      return;
    }

    // Phase 2: 检查是否有视频任务引用了此图片，清除引用
    const { getVideoTaskPersistence } =
      await import('@modules/tools/VideoGenerateTool/VideoTaskPersistence');
    const persistence = getVideoTaskPersistence();

    // 查找引用此图片路径的任务（sourceImageUrl 中可能含文件路径片段）
    const allTasks = persistence.listByStatus(
      ['pending', 'queued', 'running', 'completed'],
      200
    );

    const imagePathSegment = filePath.replace(/\\/g, '/');
    const referencingTasks = allTasks.filter(
      (t) => t.sourceImageUrl && t.sourceImageUrl.includes(imagePathSegment)
    );

    if (referencingTasks.length > 0) {
      for (const task of referencingTasks) {
        persistence.update(task.id, {
          sourceImageUrl: '',
          sourceImageId: '',
        });
      }
    }

    fs.unlinkSync(fullPath);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, path: filePath }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'image_delete' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
