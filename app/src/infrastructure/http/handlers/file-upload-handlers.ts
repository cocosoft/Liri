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
import path from 'path';
import type { HandlerCtx } from './handler-utils';
import {
  attachmentManager,
  AttachmentSource,
} from '@modules/components/attachments';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { createChatManager } from '@modules/chat/ChatManager';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';

// ========== File Upload Handlers ==========

/**
 * 处理文件上传请求
 * 遵循「用户上传文件仅保存到用户目录」规则，使用 AttachmentManager 保存到 ~/.pyapp/attachments/
 */
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: attachment.path, size: buffer.length }));
    ctx.broadcastEvent('file:uploaded', {
      path: attachment.path,
      size: buffer.length,
      filename: safeName,
      attachmentId: attachment.id,
    });
  } catch (err) {
    ctx.sendError(res, err);
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
    ctx.sendError(res, err);
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
    ctx.sendError(res, err);
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
      res.end(
        JSON.stringify({
          error: { message: 'Access denied: file path not in whitelist' },
        })
      );
      return;
    }

    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { basename } = await import('path');

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
    ctx.sendError(res, err);
  }
}
