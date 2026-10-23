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
 * 观察期「@deprecated + 加载期告警」接线守卫（2026-10-23）。
 *
 * 背景：`dev_docs/20261023/core-减重盘点清单.md` 里两类目录都走同一观察协议：
 *  · **C 档**（§3）：三重零引用，共 5 个；
 *  · **B 档复评**（§4）：原以为"业务域"，实测同样**无代码消费者**（仅文档示例），共 3 个。
 * 按 `code-deletion.md` CD07 均不能直接删 ⇒ 用「@deprecated + 被加载时告警」先观察。
 *
 * 本文件锁两件事：
 *  ① **接线不丢**：每个入口必须同时具备 `@deprecated` 标记与 `warnDeprecatedCoreModule(...)` 调用
 *     —— 少了告警，观察期就变成"盲删前置"，与沙箱误删事故同型；
 *  ② **告警内容可用**：消息里必须带 moduleId 与「观察期」字样，否则日志里无法定位。
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { warnDeprecatedCoreModule } from '../../src/core/deprecationNotice.js';
import { getLogger } from '../../src/core/loggerFacade.js';

const CORE_ROOT = join(import.meta.dir, '../../src/core');

/** 观察期入口文件（消费者会 import 的那个） */
const OBSERVED_ENTRY_FILES = [
  // C 档（§3）：三重零引用
  'storage/SecureStorage.ts',
  'lifecycle/GracefulRestartService.ts',
  'approval/ApprovalCache.ts',
  'lazy/LazyService.ts',
  'node-host/index.ts',
  // B 档复评（§4）：无代码消费者，仅文档示例
  'memory-host-sdk/index.ts',
  'media-understanding/index.ts',
  'markdown/render.ts',
  'markdown/chunk.ts',
  // B 档取证后转 C′（零消费者，与 app/src/auto-reply 同名不同物）
  'auto-reply/index.ts',
] as const;

describe('观察期：@deprecated + 加载期告警接线', () => {
  for (const rel of OBSERVED_ENTRY_FILES) {
    it(`${rel}：有 @deprecated 标记且有 warnDeprecatedCoreModule 调用`, () => {
      const source = readFileSync(join(CORE_ROOT, rel), 'utf-8');
      expect(source).toContain('@deprecated');
      expect(source).toContain('warnDeprecatedCoreModule(');
      // 标记必须指向盘点清单，避免"标了但没人知道为什么"
      expect(source).toContain('core-减重盘点清单.md');
    });
  }

  it('告警消息带 moduleId 与「观察期」字样（可在日志里定位）', () => {
    const logger = getLogger('core:deprecation');
    const spy = spyOn(logger, 'warning').mockImplementation(() => {});
    try {
      warnDeprecatedCoreModule('demo/Mod', '三重零引用');
      expect(spy).toHaveBeenCalledTimes(1);
      const message = String(spy.mock.calls[0]?.[0] ?? '');
      expect(message).toContain('core/demo/Mod');
      expect(message).toContain('观察期');
      expect(message).toContain('三重零引用');
    } finally {
      spy.mockRestore();
    }
  });
});
