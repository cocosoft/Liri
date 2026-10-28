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
 * external — **外部技术适配层**（infra · zone: storage，v3 方案 §6.1 P1）
 *
 * 当前只有 SQLite 驱动：`bun:sqlite` + 目录创建。它是**实现**（换技术栈就要动），
 * 因此按 Q5 判据「外部技术适配 ⇒ infra，永不进 core」从内核迁出：
 *
 * - 迁出前：`packages/kernel/src/core/external/sqlite3.ts`（K06 判据下 `bun:sqlite`
 *   与 `fs` 均属内核 I/O 违规，见 `scripts/kernel-io-allowlist.json`）；
 * - 迁出后：本模块。内核不再持有任何 DB 驱动。
 *
 * 若将来接入其他驱动（PostgreSQL / Redis 等），一律落在此模块，不得回流入 core。
 */

export * from './sqlite3';
