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
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

// ========== 输入解析辅助（P2-23 修复） ==========

/**
 * 安全解析请求 JSON：畸形 JSON / 非对象返回 null，由调用方回 400。
 * 原实现 JSON.parse 直接在外层 try 里，畸形 JSON 统一落 500（与缺字段的 400 不一致）。
 */
export function tryParseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * P0-1（2026-11-05）：会话工作区**重新定位**的入参校验（绝对路径 + 已存在目录）。
 *
 * 为什么不自动建目录：路径写错时静默 `mkdir` 会造出空目录 ⇒ 用户以为修好了、产物却不在
 * （与项目 relocate `project-handlers` 同一口径）。
 *
 * @returns `ok: true` 时 `path` 为 `resolve` 规范化后的绝对路径；`ok: false` ⇒ 调用方回 400
 */
export function validateWorkspacePathInput(
  raw: unknown
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'workspace_path must be a non-empty string' };
  }
  if (!isAbsolute(raw.trim())) {
    return { ok: false, error: 'workspace_path must be an absolute path' };
  }
  const resolved = resolve(raw.trim());
  try {
    if (statSync(resolved).isDirectory()) return { ok: true, path: resolved };
  } catch {
    /* @ignore-catch — 不存在 / 无权限一律按「不是可用目录」回 400（下方统一返回） */
  }
  return { ok: false, error: 'workspace_path must be an existing directory' };
}

/** 统一 400 Bad Request 响应 */
export function sendBadRequest(
  res: http.ServerResponse,
  message: string
): void {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({ error: { message, type: 'invalid_request_error' } })
  );
}

/**
 * 统一 404 Not Found 响应（TB-14，2026-09-24）——与 `handleGetSession` 的既有
 * 响应体同构：会话已被**外部进程**软删除时，各读/写接口统一 404，避免自相矛盾
 * （详情 404、消息却 200 返回陈旧内容）。
 */
export function sendNotFound(res: http.ServerResponse, message: string): void {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'not_found' } }));
}

/**
 * 时间戳单位归一化（P2-23 修复）：< 1e12 视为 Unix 秒级（×1000 转毫秒），
 * 否则视为毫秒级原样返回。防止前端传秒级时间戳被 new Date() 解析成 1970 年。
 */
export function normalizeTimestamp(raw: unknown): number | string | undefined {
  if (typeof raw === 'number') {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  return raw as number | string | undefined;
}
