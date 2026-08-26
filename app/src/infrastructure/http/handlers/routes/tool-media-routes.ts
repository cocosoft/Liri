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
 * tool-media-routes.ts — dispatchToolMediaRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { handleExecuteTool, handleListTools } from '../tools-handlers';
import {
  handleImageDelete,
  handleImageList,
  handleImageMetadata,
  handleImageStatic,
  handleImageUpload,
} from '../image-handlers';
import {
  handleVideoBySourceImage,
  handleVideoDelete,
  handleVideoExtractAudio,
  handleVideoList,
  handleVideoMetadata,
  handleVideoStatic,
  handleVideoThumbnail,
} from '../video-handlers';
import { handleAudioStatic } from '../audio-handlers';
import { handleMedia } from '../media-template-handlers';
import { handleVideoTasks } from '../video-task-handlers';

/**
 * dispatchToolMediaRoutes — tool-media-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchToolMediaRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Tools ----
  if (method === 'GET' && url === '/v1/tools') {
    await handleListTools(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/tools\/(.+)\/execute$/)) {
    await handleExecuteTool(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/tools\/(.+)\/execute$/)![1]
    );
    return true;
  }

  // ---- Images ----
  if (method === 'GET' && url === '/v1/images/list') {
    await handleImageList(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/images/metadata')) {
    await handleImageMetadata(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/images/static/')) {
    const filePath = url.slice('/v1/images/static/'.length);
    await handleImageStatic(handlerCtx, req, res, decodeURIComponent(filePath));
    return true;
  }
  if (method === 'POST' && url === '/v1/images/upload') {
    await handleImageUpload(handlerCtx, req, res);
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/images/delete')) {
    await handleImageDelete(handlerCtx, req, res);
    return true;
  }

  // ---- Videos ----
  if (method === 'GET' && url === '/v1/videos/list') {
    await handleVideoList(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/metadata')) {
    await handleVideoMetadata(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/by-source-image')) {
    await handleVideoBySourceImage(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/thumbnail')) {
    await handleVideoThumbnail(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/videos/static/')) {
    const filePath = url.slice('/v1/videos/static/'.length);
    await handleVideoStatic(handlerCtx, req, res, decodeURIComponent(filePath));
    return true;
  }
  if (method === 'DELETE' && url.startsWith('/v1/videos/delete')) {
    await handleVideoDelete(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url.startsWith('/v1/videos/extract-audio')) {
    await handleVideoExtractAudio(handlerCtx, req, res);
    return true;
  }

  // ---- Audio ----
  if (method === 'GET' && url.startsWith('/v1/audio/static/')) {
    const filePath = url.slice('/v1/audio/static/'.length);
    await handleAudioStatic(handlerCtx, req, res, decodeURIComponent(filePath));
    return true;
  }

  // ---- Media ----
  // BUG-1 修复：原 `url.startsWith('/v1/media')` 泛匹配会劫持 /v1/media/subtitle（字幕
  // 生成/下载，正确 handler 在 auth-access-routes，分发顺序在其之前导致死代码）。
  // handleMedia 仅处理 /v1/media/templates*，改为精确前缀匹配，其余放行到后续路由。
  if (url.startsWith('/v1/media/templates')) {
    await handleMedia(handlerCtx, req, res);
    return true;
  }

  // ---- Video Tasks (async) ----
  if (url.startsWith('/v1/video/tasks')) {
    await handleVideoTasks(handlerCtx, req, res);
    return true;
  }
  return false;
}
