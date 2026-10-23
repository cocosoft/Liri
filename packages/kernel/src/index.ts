// MIT License
// Copyright (c) 2026 Liri
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
 * `@openliri/kernel` 包入口。
 *
 * 内核实现在 `./core/`（P4 由 `app/src/core` 物理迁入，内容零改动）。
 * 包入口只做**自身内聚的桶导出** —— 不转发任何上层（entry/ui/app/service/infra）实现：
 * 内核的依赖方向必须单向（`core ← 其余各层`），由 `bun run lint:kernel` 强制。
 *
 * 目录保留 `core/` 这一层是**刻意**的（方案 §4-P4 记录）：
 * 架构门禁 `lint:arch` 的模块识别取路径首段（`core/...`），保留该层可使
 * 内核文件的模块归属与迁移前**逐字一致**，避免门禁静默失焦（AR-3）。
 */
export const KERNEL_PACKAGE_NAME = '@openliri/kernel';

/** 包版本（P6 起由发版流程维护） */
export const KERNEL_PACKAGE_VERSION = '0.1.0';

export * from './core/index.js';
