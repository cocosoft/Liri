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
 * 跨端事件 schema 一致性单测（C-1，2026-08-23）
 *
 * 规格 C-1「前端为唯一基线 + 后端镜像拷贝 + 跨端一致性单测」：
 * 后端 `app/src/chat/types/events.ts` 的 LiriEventMap 事件 key 集合
 * 必须与前端 `client/src/types/events.ts` 完全一致——防止两端 schema 漂移
 * （后端 emit / 后端派生 / 前端聚合三处对齐，避免"流式 ≠ 回放"）。
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const APP_EVENTS = join(process.cwd(), 'src/chat/types/events.ts');
// client 与 app 同级（仓库根 PY_APP/client）
const CLIENT_EVENTS = join(process.cwd(), '../client/src/types/events.ts');

/** 从 events.ts 提取 LiriEventMap 的事件 key 集合 */
function extractEventKeys(filePath: string): Set<string> {
  const src = readFileSync(filePath, 'utf-8');
  const keys = new Set<string>();
  // 匹配 LiriEventMap 内的 `'type': {` / `"type": {`（前端双引号、后端单引号）
  const re = /^\s*['"]([a-z_/]+)['"]:\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

describe('跨端事件 schema 一致性（C-1）', () => {
  it('前后端 events.ts 文件存在', () => {
    expect(existsSync(APP_EVENTS)).toBe(true);
    expect(existsSync(CLIENT_EVENTS)).toBe(true);
  });

  it('后端 LiriEventMap 事件 key 与前端完全一致（镜像拷贝无漂移）', () => {
    const appKeys = extractEventKeys(APP_EVENTS);
    const clientKeys = extractEventKeys(CLIENT_EVENTS);

    const missingInApp = [...clientKeys].filter((k) => !appKeys.has(k));
    const missingInClient = [...appKeys].filter((k) => !clientKeys.has(k));

    expect(missingInApp).toEqual([]);
    expect(missingInClient).toEqual([]);
    // 至少覆盖核心事件（防止提取正则失效导致空集合假通过）
    expect(appKeys.has('user/message')).toBe(true);
    expect(appKeys.has('assistant/tool_call')).toBe(true);
    expect(appKeys.has('context/compaction')).toBe(true);
    expect(appKeys.has('assistant/deliverable')).toBe(true);
    expect(appKeys.has('assistant/diff')).toBe(true);
  });
});
