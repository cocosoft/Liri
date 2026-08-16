/**
 * Audio Handlers
 * 音频静态文件服务
 *
 * 端点：
 *   GET /v1/audio/static/*  — 提供音频文件（支持 Range 请求用于 seek）
 *
 * 音频存储目录：~/.pyapp/media/audio/
 */
import type http from 'http';
import fs from 'fs';
import path from 'path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { resolveMediaDir, isPathWithin } from '@modules/core/paths';

/** 音频根目录 */
const AUDIO_ROOT = path.join(resolveMediaDir(), 'audio');

/** MIME 类型映射 */
const AUDIO_MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.opus': 'audio/opus',
};

function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_MAP[ext] || 'application/octet-stream';
}

function isAudioRootSafe(requestedPath: string): boolean {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    return isPathWithin(AUDIO_ROOT, resolved);
  }
  const resolved = path.resolve(AUDIO_ROOT, requestedPath);
  return isPathWithin(AUDIO_ROOT, resolved);
}

function resolveAudioPath(requestedPath: string): string | null {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    if (isPathWithin(AUDIO_ROOT, resolved)) return resolved;
    return null;
  }
  const resolved = path.resolve(AUDIO_ROOT, requestedPath);
  if (!isPathWithin(AUDIO_ROOT, resolved)) return null;
  return resolved;
}

/**
 * GET /v1/audio/static/*
 * 提供音频静态文件服务（支持 HTTP Range 请求）
 */
export async function handleAudioStatic(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string
): Promise<void> {
  try {
    if (!isAudioRootSafe(filePath)) {
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = resolveAudioPath(filePath);
    if (!fullPath) {
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Audio not found' }));
      return;
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Audio not found' }));
      return;
    }

    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const mimeType = getAudioMimeType(fullPath);

    // BUG-6 修复：Range 无校验 — NaN/负数/end>fileSize 时 Buffer.alloc 抛
    // RangeError → 500。严格解析，非法/不可满足一律 416。
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
    await handleError(err, { module: 'infra:http', action: 'audio_static' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
