/**
 * Video Handlers
 * 视频静态文件服务 + 视频列表 API + 视频删除 API
 *
 * 端点：
 *   GET    /v1/videos/static/*  — 提供视频文件（支持 Range 请求用于 seek）
 *   GET    /v1/videos/list       — 列出所有已生成的视频
 *   DELETE /v1/videos/delete     — 删除视频（按路径）
 *
 * 视频存储目录：~/.pyapp/media/video/
 */

import type http from 'http';
import fs from 'fs';
import path from 'path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { resolveMediaDir } from '@modules/core/paths';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure:http:handlers:video-handlers',
  level: LogLevel.INFO,
});

/** 视频根目录（AI 生成持久化） */
const VIDEOS_ROOT = path.join(resolveMediaDir(), 'video');

/** MIME 类型映射 */
const VIDEO_MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
};

/** 支持的视频扩展名 */
const _VIDEO_EXTENSIONS = Object.keys(VIDEO_MIME_MAP);

/**
 * 获取视频文件的 MIME 类型
 */
function getVideoMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * 安全检查 — 确保解析后的绝对路径在安全根目录内
 */
function isVideoRootSafe(requestedPath: string): boolean {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return resolved.startsWith(VIDEOS_ROOT);
  }

  const resolved = path.resolve(VIDEOS_ROOT, requestedPath);
  return resolved.startsWith(VIDEOS_ROOT);
}

/**
 * 解析请求路径到完整文件路径
 */
function resolveVideoPath(requestedPath: string): string | null {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    if (resolved.startsWith(VIDEOS_ROOT)) return resolved;
    return null;
  }

  const resolved = path.resolve(VIDEOS_ROOT, requestedPath);
  if (!resolved.startsWith(VIDEOS_ROOT)) return null;
  return resolved;
}

/**
 * 递归遍历目录收集视频文件
 */
function collectVideoFiles(
  dir: string,
  basePath: string,
  files: string[]
): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectVideoFiles(fullPath, basePath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_MIME_MAP[ext]) {
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
 * 从 DB file_files 表读取已注册的视频文件，合并文件系统扫描结果
 */
function collectRegisteredVideos(): Array<{
  relativePath: string;
  absolutePath: string;
}> {
  const result: Array<{ relativePath: string; absolutePath: string }> = [];

  // 从 DB 读取已注册的视频文件（file_files 表 store_zone = 'media', media_type = 'video'）
  try {
    const { Database } = require('bun:sqlite');
    const { resolveDbPath } = require('@modules/core/paths');
    const db = new Database(resolveDbPath(), { readonly: true });

    const rows = db
      .query(
        `SELECT saved_name, saved_path, original_name 
         FROM file_files 
         WHERE store_zone = 'media' AND media_type = 'video' 
         ORDER BY created_at DESC`
      )
      .all() as Array<{
      saved_name: string;
      saved_path: string;
      original_name: string;
    }>;

    for (const row of rows) {
      const absPath = path.resolve(VIDEOS_ROOT, row.saved_name);
      if (fs.existsSync(absPath)) {
        result.push({
          relativePath: row.saved_name,
          absolutePath: absPath,
        });
      }
    }

    db.close();
  } catch (err) {
    // DB 不可用，回退到文件系统扫描

    logger.debug('Operation skipped', {
      context: 'DB 不可用，回退到文件系统扫描',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

/**
 * GET /v1/videos/static/*
 * 提供视频静态文件服务（支持 HTTP Range 请求用于视频 seek）
 */
export async function handleVideoStatic(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string
): Promise<void> {
  try {
    // 安全检查
    if (!isVideoRootSafe(filePath)) {
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = resolveVideoPath(filePath);
    if (!fullPath) {
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Video not found' }));
      return;
    }

    // 文件存在性检查
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Video not found' }));
      return;
    }

    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const mimeType = getVideoMimeType(fullPath);

    // 处理 Range 请求（视频 seek 需要）
    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      const buffer = Buffer.alloc(chunkSize);
      const fd = fs.openSync(fullPath, 'r');
      fs.readSync(fd, buffer, 0, chunkSize, start);
      fs.closeSync(fd);

      res.writeHead(206, {
        'Content-Type': mimeType,
        'Content-Length': chunkSize,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buffer);
      return;
    }

    // 完整文件响应
    const buffer = fs.readFileSync(fullPath);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buffer);
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'video_static' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * GET /v1/videos/metadata?path=xxx
 * 返回视频文件的元数据（Phase 3.4: 信息面板）
 * 从 DB video_tasks 表交叉引用 prompt、model、source_image_url
 */
export async function handleVideoMetadata(
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

    const fullPath = resolveVideoPath(filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Video not found' }));
      return;
    }

    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase().replace('.', '');
    const fileName = path.basename(fullPath);

    // 从 DB 查询视频任务的元数据（prompt、model、source_image_url）
    let prompt: string | null = null;
    let model: string | null = null;
    let sourceImageUrl: string | null = null;
    let sourceImagePath: string | null = null;
    let mode: string | null = null;

    try {
      const { Database } = require('bun:sqlite');
      const { resolveDbPath } = require('@modules/core/paths');
      const db = new Database(resolveDbPath(), { readonly: true });

      // 从 video_tasks 表查询（按 result_video_url LIKE 匹配）
      const likePattern = `%${fileName}%`;
      const row = db
        .query(
          `SELECT prompt, model, source_image_url, source_image_path, mode
           FROM video_tasks
           WHERE result_video_url LIKE ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(likePattern) as any;

      if (row) {
        prompt = row.prompt || null;
        model = row.model || null;
        sourceImageUrl = row.source_image_url || null;
        sourceImagePath = row.source_image_path || null;
        mode = row.mode || null;
      }
      db.close();
    } catch (err) {
      // DB 不可用，忽略

      logger.debug('Operation skipped', {
        context: 'DB 不可用，忽略',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        path: fullPath,
        size: stat.size,
        format: ext,
        duration: null, // TODO: 需要 ffprobe 获取视频时长
        createdAt: stat.birthtimeMs,
        modifiedAt: stat.mtimeMs,
        prompt,
        model,
        mode,
        sourceImageUrl,
        sourceImagePath,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'video_metadata' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * GET /v1/videos/by-source-image?path=xxx
 * 查询由指定图片生成的视频列表（Phase 6.1: 图生视频溯源）
 */
export async function handleVideoBySourceImage(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const rawUrl = req.url || '/';
    const urlObj = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const imagePath = urlObj.searchParams.get('path');

    if (!imagePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }

    // 使用 VideoTaskPersistence 查询
    const { getVideoTaskPersistence } =
      await import('@modules/tools/VideoGenerateTool/VideoTaskPersistence');
    const persistence = getVideoTaskPersistence();

    const tasks = persistence.listBySourceImagePath(imagePath);

    const videos = tasks
      .filter((t) => t.resultVideoUrl)
      .map((t) => ({
        taskId: t.id,
        status: t.status,
        mode: t.mode,
        prompt: t.prompt,
        model: t.model || null,
        sourceImageUrl: t.sourceImageUrl || null,
        sourceImagePath: t.sourceImagePath || null,
        resultVideoUrl: t.resultVideoUrl || null,
        progress: t.progress,
        createdAt: t.createdAt,
        completedAt: t.completedAt || null,
      }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ videos, count: videos.length }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'video_by_source_image',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * GET /v1/videos/list?page=1&pageSize=50
 * 列出已生成的视频文件（支持分页）
 * 从 DB file_files 表读取（已注册的视频），回退到文件系统扫描
 */
export async function handleVideoList(
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

    // 先从 DB 读取已注册的视频
    let dbVideos = collectRegisteredVideos();

    // 同时扫描文件系统中 DB 可能未注册的文件
    const fsFiles: string[] = [];
    if (fs.existsSync(VIDEOS_ROOT)) {
      collectVideoFiles(VIDEOS_ROOT, VIDEOS_ROOT, fsFiles);
    }

    // 合并去重（按文件名）
    const seenNames = new Set(
      dbVideos.map((v) => path.basename(v.absolutePath))
    );
    for (const f of fsFiles) {
      const absPath = path.join(VIDEOS_ROOT, f);
      if (!seenNames.has(path.basename(absPath))) {
        dbVideos.push({ relativePath: f, absolutePath: absPath });
        seenNames.add(path.basename(absPath));
      }
    }

    // 按文件修改时间倒序（新的在前）
    dbVideos.sort((a, b) => {
      try {
        const statA = fs.statSync(a.absolutePath);
        const statB = fs.statSync(b.absolutePath);
        return statB.mtimeMs - statA.mtimeMs;
      } catch {
        return 0;
      }
    });

    const total = dbVideos.length;
    const startIdx = (page - 1) * pageSize;
    const paged = dbVideos.slice(startIdx, startIdx + pageSize);

    const videos = paged.map((f) => ({
      path: f.absolutePath,
      url: `/v1/videos/static/${f.relativePath.replace(/\\/g, '/')}`,
    }));

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        videos,
        total,
        page,
        pageSize,
        hasMore: startIdx + pageSize < total,
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'video_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * DELETE /v1/videos/delete?path=fileName.mp4
 * 删除指定路径的视频文件
 */
export async function handleVideoDelete(
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

    // 安全检查
    if (!isVideoRootSafe(filePath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = resolveVideoPath(filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Video not found' }));
      return;
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot delete directory' }));
      return;
    }

    // 删除物理文件
    fs.unlinkSync(fullPath);

    // 尝试从 DB 中移除记录
    try {
      const { Database } = require('bun:sqlite');
      const { resolveDbPath } = require('@modules/core/paths');
      const db = new Database(resolveDbPath());
      const fileName = path.basename(fullPath);
      db.prepare(`DELETE FROM file_files WHERE saved_name = ?`).run(fileName);
      db.close();
    } catch (err) {
      // DB 不可用，忽略

      logger.debug('Operation skipped', {
        context: 'DB 不可用，忽略',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, path: filePath }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'video_delete' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
