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

/** rename 的**瞬时占用**类错误（Windows：目标被并发句柄 / 索引器 / 杀软短暂占用） */
const TRANSIENT_RENAME_CODES = ['EPERM', 'EBUSY', 'EACCES'];

/** 进程内单调序号（与 pid 组合保证跨实例/跨进程唯一） */
let tmpSeq = 0;

/**
 * 原子写文件：唯一临时名 + `rename` 替换；`rename` 对瞬时占用做有界重试（3 次）。
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
  await fs.writeFile(tmpPath, data, 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT_RENAME_CODES.includes(code) || attempt >= 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}
