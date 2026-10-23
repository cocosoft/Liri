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
 * `@openliri/kernel` —— **P1 骨架占位**（见 core-独立包-落地方案 §4-P1）。
 *
 * 这里**刻意不转发** `app/src/core` 的任何实现，原因（实测 2026-10-23）：
 * bun 的 `file:` 依赖在 Windows 上会把包**复制**进 `node_modules`，
 * 相对路径 `../../../app/src/core/...` 因此会解析到 `app/app/src/core`（不存在）。
 * 更重要的是：即便能解析，那也会制造一条 **kernel → app 的反向依赖** ——
 * 与「内核独立成包」完全相反，属于用临时手段换来的假绿。
 *
 * 因此 P1 只验证「包名可解析 / 依赖可安装 / 构建不受影响」；
 * 真正的实现在 **P4** 由 `git mv app/src/core/* packages/kernel/src/` 迁入。
 */

/** 包标识（供宿主自证与后续 api-surface 使用） */
export const KERNEL_PACKAGE_NAME = '@openliri/kernel';

/** 包版本（P6 起由发版流程维护） */
export const KERNEL_PACKAGE_VERSION = '0.1.0';

/**
 * P1 骨架标记：`app/src/core` 的源码**尚未**迁入本包。
 * P4 完成后本常量删除（届时本条即为「迁移完成」的机械判据）。
 */
export const KERNEL_SKELETON_ONLY = true;
