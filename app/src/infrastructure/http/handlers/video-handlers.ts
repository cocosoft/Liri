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
import { randomUUID } from 'crypto';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { resolveMediaDir, isPathWithin } from '@modules/core/paths';
import { ffmpegWrapper } from '../../../media/ffmpeg/FFmpegWrapper';
import { videoProcessor } from '../../../media/video/VideoProcessor';

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

/** 视频元信息（ffprobe 结果子集） */
interface VideoMeta {
  duration: number | null;
  width: number | null;
  height: number | null;
}

/** 元信息缓存：path+mtime+size → meta，文件变更后自动失效 */
const videoMetaCache = new Map<string, VideoMeta>();

/**
 * 通过 ffprobe 获取视频时长/尺寸（带缓存，失败降级 null）
 */
async function getVideoMeta(absPath: string): Promise<VideoMeta> {
  try {
    const stat = fs.statSync(absPath);
    const key = `${absPath}:${stat.mtimeMs}:${stat.size}`;
    const cached = videoMetaCache.get(key);
    if (cached) return cached;

    const info = await ffmpegWrapper.probe(absPath);
    const videoStream = info?.streams?.find((s) => s.codec_type === 'video');
    const rawDuration = info?.format?.duration ?? videoStream?.duration ?? null;
    const meta: VideoMeta = {
      duration:
        rawDuration != null && Number.isFinite(rawDuration)
          ? Math.round(rawDuration * 10) / 10
          : null,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
    };
    videoMetaCache.set(key, meta);
    return meta;
  } catch {
    return { duration: null, width: null, height: null };
  }
}

/**
 * 安全检查 — 确保解析后的绝对路径在安全根目录内
 */
function isVideoRootSafe(requestedPath: string): boolean {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return isPathWithin(VIDEOS_ROOT, resolved);
  }

  const resolved = path.resolve(VIDEOS_ROOT, requestedPath);
  return isPathWithin(VIDEOS_ROOT, resolved);
}

/**
 * 解析请求路径到完整文件路径
 */
function resolveVideoPath(requestedPath: string): string | null {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    if (isPathWithin(VIDEOS_ROOT, resolved)) return resolved;
    return null;
  }

  const resolved = path.resolve(VIDEOS_ROOT, requestedPath);
  if (!isPathWithin(VIDEOS_ROOT, resolved)) return null;
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

    handleError(err, {
      module: 'infrastructure:http:handlers:video-handlers',
      action: 'directoryNotReadable',
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

    handleError(err, {
      module: 'infrastructure:http:handlers:video-handlers',
      action: 'dbUnavailableFallback',
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
    // BUG-6 修复：原实现无校验 — parseInt 得 NaN / 负数 / end>fileSize 时
    // Buffer.alloc 抛 RangeError → 500。改为严格解析，非法/不可满足一律 416。
    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!rangeMatch || fileSize === 0) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      let start: number;
      let end: number;
      if (rangeMatch[1] === '') {
        // 后缀范围 bytes=-N：取末尾 N 字节
        const suffix = parseInt(rangeMatch[2], 10);
        if (!Number.isFinite(suffix) || suffix <= 0) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          res.end();
          return;
        }
        start = Math.max(0, fileSize - suffix);
        end = fileSize - 1;
      } else {
        start = parseInt(rangeMatch[1], 10);
        end = rangeMatch[2] !== '' ? parseInt(rangeMatch[2], 10) : fileSize - 1;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start
        ) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          res.end();
          return;
        }
      }

      if (start >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      // 防 end 超出文件大小导致 readSync 越界
      if (end >= fileSize) end = fileSize - 1;

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
        .get(likePattern) as
        | {
            prompt?: string;
            model?: string;
            source_image_url?: string;
            source_image_path?: string;
            mode?: string;
          }
        | undefined;

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

      handleError(err, {
        module: 'infrastructure:http:handlers:video-handlers',
        action: 'dbUnavailable',
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

    // P0-1 第二阶段（2026-08-26）：keyword 文件名过滤（不区分大小写）
    const keyword = (urlObj.searchParams.get('keyword') || '')
      .trim()
      .toLowerCase();
    if (keyword) {
      dbVideos = dbVideos.filter((v) =>
        path.basename(v.absolutePath).toLowerCase().includes(keyword)
      );
    }

    // BUG-E（2026-08-26）：dateRange 按文件 mtime 过滤（today/7days/30days），
    // 与前端 GallerySearchBar 语义一致，避免分页 hasMore 失真导致无限滚动空转
    const dateRange = urlObj.searchParams.get('dateRange') || 'all';
    if (dateRange !== 'all') {
      const now = Date.now();
      let cutoffMs = 0;
      if (dateRange === 'today') {
        cutoffMs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
      } else if (dateRange === '7days') {
        cutoffMs = now - 7 * 24 * 3600 * 1000;
      } else if (dateRange === '30days') {
        cutoffMs = now - 30 * 24 * 3600 * 1000;
      }
      dbVideos = dbVideos.filter((v) => {
        try {
          return fs.statSync(v.absolutePath).mtimeMs >= cutoffMs;
        } catch {
          return false;
        }
      });
    }

    const total = dbVideos.length;
    const startIdx = (page - 1) * pageSize;
    const paged = dbVideos.slice(startIdx, startIdx + pageSize);

    // P2-13 修复：列表补 duration/width/height（ffprobe 探测 + mtime 缓存，
    // 避免重复 probe；探测失败降级 null 不影响列表）。缩略图由前端原生
    // <video> 首帧渲染，无需额外缩略图管线。
    const videos = await Promise.all(
      paged.map(async (f) => {
        const meta = await getVideoMeta(f.absolutePath);
        return {
          path: f.absolutePath,
          url: `/v1/videos/static/${f.relativePath.replace(/\\/g, '/')}`,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
        };
      })
    );

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

      handleError(err, {
        module: 'infrastructure:http:handlers:video-handlers',
        action: 'dbUnavailable',
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

/**
 * POST /v1/videos/extract-audio?path=fileName.mp4
 * 从视频中提取音频（P0-3 第二步，2026-08-26）
 *
 * 仿字幕管线路径处理（media-handlers handleMediaSubtitleGenerate）：
 * 用 videoProcessor.extractAudio 转码为 16kHz 单声道 WAV，
 * 输出到音频目录 ~/.pyapp/media/audio/，返回 /v1/audio/static/ 可访问 URL。
 */
export async function handleVideoExtractAudio(
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

    // 安全检查（与 handleVideoDelete 一致）
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

    // 输出到音频目录（与 handleAudioStatic 的 AUDIO_ROOT 一致）
    const audioDir = path.join(resolveMediaDir(), 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    const baseName = path.basename(fullPath, path.extname(fullPath));
    const outName = `${baseName}_audio_${randomUUID().slice(0, 8)}.wav`;
    const outPath = path.join(audioDir, outName);

    const success = await videoProcessor.extractAudio(fullPath, outPath);
    if (!success || !fs.existsSync(outPath)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '音频提取失败，请确认 ffmpeg 已安装' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        url: `/v1/audio/static/${outName}`,
        path: outPath,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'video_extract_audio',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

/**
 * GET /v1/videos/thumbnail?path=fileName.mp4
 * 生成/返回视频缩略图（JPG），供画廊 poster 使用（2026-08-26）
 *
 * 复用 videoProcessor.extractThumbnail（ffmpeg 截帧，-ss 1s -vframes 1）。
 * 缓存：缩略图写入 ~/.pyapp/media/video/thumbs/，视频 mtime 变化时重新生成。
 */
export async function handleVideoThumbnail(
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

    // 安全检查（与 handleVideoDelete 一致）
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

    const videoMtime = fs.statSync(fullPath).mtimeMs;

    // 缩略图目录（视频目录下 thumbs/，与 VIDEOS_ROOT 同根）
    const thumbsDir = path.join(VIDEOS_ROOT, 'thumbs');
    if (!fs.existsSync(thumbsDir)) {
      fs.mkdirSync(thumbsDir, { recursive: true });
    }
    const thumbPath = path.join(
      thumbsDir,
      `${path.basename(fullPath, path.extname(fullPath))}.jpg`
    );

    // 缓存命中：缩略图存在且不比视频旧
    if (
      !fs.existsSync(thumbPath) ||
      fs.statSync(thumbPath).mtimeMs < videoMtime
    ) {
      const ok = await videoProcessor.extractThumbnail(fullPath, thumbPath, 1);
      if (!ok || !fs.existsSync(thumbPath)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: '缩略图生成失败，请确认 ffmpeg 已安装' })
        );
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(fs.readFileSync(thumbPath));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'video_thumbnail',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
