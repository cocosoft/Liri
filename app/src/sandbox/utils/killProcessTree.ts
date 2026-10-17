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
 * 进程树终止助手 —— **沙箱侧稳定入口**（R21，2026-10-09）。
 *
 * U-16（2026-10-17）：实现已下沉到 `utils/killProcessTree.ts`（infra），使 `infrastructure`
 * 层（A2A sidecar 监督器）可在不跨层直连 `@modules/sandbox` 的前提下复用同一份强杀逻辑。
 * 本文件保留导出（`@modules/sandbox` 的公开面不变），沙箱侧消费者与单测**零改动**。
 */
export {
  killProcessTree,
  type KillableChild,
  type KillProcessTreeDeps,
} from '../../utils/killProcessTree.js';
