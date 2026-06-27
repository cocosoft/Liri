/**
 * Image Handlers
 * 图片静态文件服务 + 图片列表 API
 *
 * 端点：
 *   GET /v1/images/static/*  — 提供 ~/.pyapp/output/images/ 下的图片文件
 *   GET /v1/images/list       — 列出所有已生成的图片
 */

import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { resolveOutputDir } from '@modules/core/paths';

/** 图片输出根目录 */
const IMAGES_ROOT = path.join(resolveOutputDir(), 'images');

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

/**
 * 获取文件的 MIME 类型
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * 路径遍历安全检查
 * 确保请求的路径在 IMAGES_ROOT 范围内
 */
function isPathSafe(requestedPath: string): boolean {
  const resolved = path.resolve(IMAGES_ROOT, requestedPath);
  // 规范化后必须在 IMAGES_ROOT 内
  return resolved.startsWith(IMAGES_ROOT) && !resolved.includes('..');
}

/**
 * 递归遍历目录收集图片文件路径
 */
function collectImageFiles(dir: string, basePath: string, files: string[]): void {
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
  } catch {
    // 目录不存在或不可读，忽略
  }
}

/**
 * GET /v1/images/static/*
 * 提供图片静态文件服务
 *
 * URL 格式：/v1/images/static/YYYY-MM-DD/img_xxx.png
 * 安全：仅允许 ~/.pyapp/output/images/ 下的路径，拒绝路径遍历
 */
export async function handleImageStatic(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string
): Promise<void> {
  try {
    // 安全检查：拒绝路径遍历
    if (!isPathSafe(filePath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    const fullPath = path.resolve(IMAGES_ROOT, filePath);

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
 * GET /v1/images/list
 * 列出所有已生成的图片文件
 */
export async function handleImageList(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const files: string[] = [];

    if (fs.existsSync(IMAGES_ROOT)) {
      collectImageFiles(IMAGES_ROOT, IMAGES_ROOT, files);
    }

    // 按路径排序（日期目录 + 文件名，天然按时间排序）
    files.sort().reverse();

    // 构建完整 URL
    const images = files.map((f) => ({
      path: f.replace(/\\/g, '/'),
      url: `/v1/images/static/${f.replace(/\\/g, '/')}`,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ images }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'image_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
