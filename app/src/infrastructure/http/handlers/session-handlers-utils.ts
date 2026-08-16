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
 * 时间戳单位归一化（P2-23 修复）：< 1e12 视为 Unix 秒级（×1000 转毫秒），
 * 否则视为毫秒级原样返回。防止前端传秒级时间戳被 new Date() 解析成 1970 年。
 */
export function normalizeTimestamp(raw: unknown): number | string | undefined {
  if (typeof raw === 'number') {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  return raw as number | string | undefined;
}
