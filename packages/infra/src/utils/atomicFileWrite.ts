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
 * 原子文件写入（tmp + rename）——**并发安全**的最小原语。
 *
 * 与 `session/persistence/AtomicWriter`（service 层，带指标/错误类型）区分：本原语属
 * infra 层通用工具，供 memory 等同层/下层模块直接复用，避免各模块自写一份「固定 `.tmp`」。
 *
 * 为什么临时名必须**每次唯一**（真机 `app.log` 实证，2026-10-31）：
 * 固定 `.tmp` 时，并发写入的后到者在 `rename` 阶段发现 tmp 已被先到者消费 ⇒
 * `ENOENT: rename '…memory-index.json.tmp' -> '…memory-index.json'`（同一秒 3 条）；
 * 记忆关系图（`save_relation_graph`）同源命中。唯一名让 rename 的目标只可能被本次写入消费。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ATOMIC_WRITE_RENAME_RETRY_BASE_MS,
  ATOMIC_WRITE_RENAME_RETRY_JITTER_MS,
} from '@openliri/infra/constants';

/** rename 的**瞬时占用**类错误（Windows：目标被并发句柄 / 索引器 / 杀软短暂占用） */
const TRANSIENT_RENAME_CODES = ['EPERM', 'EBUSY', 'EACCES'];

/** rename 尝试次数上限（含首次）—— 与 `session/persistence/AtomicWriter` 的 3 次同口径 */
const RENAME_MAX_ATTEMPTS = 3;

/** 进程内单调序号（与 pid 组合保证跨实例/跨进程唯一） */
let tmpSeq = 0;

/**
 * 原子写文件：唯一临时名 + `rename` 替换；`rename` 对瞬时占用做有界重试。
 *
 * 重试预算（2026-11-21，CI 实证）：原为「3 次 / 10+20ms ≈ 30ms」，在 windows-latest 上
 * 跑 8 并发用例时**耗尽重试**（run 44763744931：`EPERM` 于 `atomicFileWrite.ts:57`，用例 50.93ms 即失败，
 * 而同期 ubuntu / macos 全绿）—— Windows runner 的杀软实时扫描会短暂握住刚写入的临时文件句柄。
 * 现对齐 service 层 `AtomicWriter`（3 次 / 100ms）的预算并加抖动（最坏等 300ms + 抖动），仍为有界。
 *
 * 失败即清理本次临时文件：临时名唯一 ⇒ **不会**被后来者接手，不清理就是永久残留
 * （`tests/utils/atomicFileWrite.test.ts` 把「无残留 .tmp」作为不变量）。
 *
 * 非瞬时错误（如 `ENOENT`）**不重试**，直接上抛 —— 不掩盖真实失败。
 */
export async function writeFileAtomic(
  targetPath: string,
  data: string
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  tmpSeq += 1;
  const tmpPath = `${targetPath}.${process.pid}.${tmpSeq}.tmp`;
  try {
    await fs.writeFile(tmpPath, data, 'utf8');
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(tmpPath, targetPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          !code ||
          !TRANSIENT_RENAME_CODES.includes(code) ||
          attempt >= RENAME_MAX_ATTEMPTS
        ) {
          throw error;
        }
        const backoffMs =
          ATOMIC_WRITE_RENAME_RETRY_BASE_MS * attempt +
          Math.floor(Math.random() * ATOMIC_WRITE_RENAME_RETRY_JITTER_MS);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {
      // @ignore-catch: 清理失败不改写原始错误（tmp 残留由系统临时目录策略兜底）
    });
    throw error;
  }
}
