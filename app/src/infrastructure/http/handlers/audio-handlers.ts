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
import { resolveMediaDir } from '@modules/core/paths';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'infrastructure\http\handlers\audio-handlers', level: LogLevel.INFO });

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
    return resolved.startsWith(AUDIO_ROOT);
  }
  const resolved = path.resolve(AUDIO_ROOT, requestedPath);
  return resolved.startsWith(AUDIO_ROOT);
}

function resolveAudioPath(requestedPath: string): string | null {
  if (path.isAbsolute(requestedPath)) {
    const resolved = path.resolve(requestedPath);
    if (resolved.startsWith(AUDIO_ROOT)) return resolved;
    return null;
  }
  const resolved = path.resolve(AUDIO_ROOT, requestedPath);
  if (!resolved.startsWith(AUDIO_ROOT)) return null;
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
