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
 * 租户级 DB 期 3：`inboxChannelReply` 的死信表（基础设施专项 §6.1）。
 *
 * 该表**只写不读**（失败回传的死信留痕），无法从外部驱动失败路径 ⇒ 以静态门禁锁定：
 * 落租户库、行带 `owner_key`、旧库补列。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('门禁：inbox_reply_deadletter 落在租户库且带 owner_key', () => {
  const src = readFileSync(
    new URL('../../src/channels/bridge/inboxChannelReply.ts', import.meta.url),
    'utf8'
  );

  it('路径解析改用 resolveTenantDbPath（不再按用户分区）', () => {
    expect(src).toContain('resolveTenantDbPath');
    expect(src).not.toContain('resolveScopedDbPath');
  });

  it('建表 / INSERT 都带 owner_key，且旧库有补列语句', () => {
    const templates = [
      ...src.matchAll(/`[^`]*\binbox_reply_deadletter\b[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(CREATE|INSERT|ALTER)\b/.test(sql)
    );
    expect(rowSql.length).toBeGreaterThanOrEqual(3);
    for (const sql of rowSql) expect(sql).toContain('owner_key');
  });
});
