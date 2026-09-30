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
 * 「预期中断」判据 —— **转出（re-export）**（2026-09-30）。
 *
 * 定义已**下沉至 core 侧** `core/utils/abortReason.ts`：判据需在**所有层**使用，而 core 侧
 * 消费方（`core/exit/ExitRecorder`）直接引用 infra 层构成 core → infra 倒挂（A 类台账，
 * 见 .trae/specs/layer-inversion-a-class-inventory.md §3.5.1）。本文件保留**同名导出**
 * ⇒ `@modules/error` 对外导出名与签名**逐字不变**（CS01-ROOTFIX 收敛，无行为差异）。
 */

export {
  SYSTEM_ABORT_REASON,
  SYSTEM_ABORT_BRAND,
  markAsExpectedAbort,
  isAbortReason,
} from '../core/abortReason.js';
