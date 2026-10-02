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
import path from 'path';
import type { HandlerCtx } from './handler-utils';
// 2026-10-02 D-226（`service -> ui` 收口）：原 `@modules/components/attachments`（ui 层）⇒
// `AttachmentManager` 已物理归位 `services/file/attachments.ts`（service 层，同层引用合法）。
import {
  attachmentManager,
  AttachmentSource,
} from '@modules/services/file/attachments';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
// 2026-10-01 D-201（chat 域取用面收敛）：原**静态**导入 app 层 `@modules/chat` 的
// `createChatManager()` ⇒ `infrastructure -> app` 倒挂。
// ⚠️ **同时修正实测缺陷**：`createChatManager()` 每次是**新实例**（`_chatSessions` 为空、
// `_currentSessionId` 未设）⇒ 原 `sendMessage()` 实际发往**新建会话**而非用户当前会话；
// 改用进程内共享的 ChatManager ⇒ 文件内容发往**当前活跃会话**
// （与「将文件内容作为消息发送给AI」的语义一致）。
// 2026-10-01 D-186（子批 C）：`SandboxPermission` 是 core 叶子 ⇒ 相对直连，消除 `infrastructure -> app`。
import { SandboxPermission } from '../../../core/sandboxPermission.js';

// ========== File Upload Handlers ==========

/** 上传文件大小上限：超过拒绝，避免大文件 base64 解码/写盘导致内存耗尽 */
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

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
    if (buffer.length > MAX_UPLOAD_SIZE) {
      const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `文件过大（${sizeMB}MB），超过上传上限 ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`,
          },
        })
      );
      return;
    }
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

    const { readFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { basename } = await import('path');

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'File not found' } }));
      return;
    }

    const content = await readFile(filePath, 'utf-8');
    const fileName = basename(filePath);

    // 将文件内容作为消息发送给AI
    const chatManager = getCoreAPI().getChatManager();

    const message = `请分析以下文件内容（文件名: ${fileName}）:\n\n${content}`;
    // 上传文件自动分析为系统内部调用：不计入 Buddy 用户对话轮数
    await chatManager.sendMessage(message, {
      _fromInternal: true,
      _fromInternalSource: 'fileSendToAI',
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, fileName, size: content.length }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
