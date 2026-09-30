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
 * 标准错误码 —— **转出（re-export）**（2026-09-30）。
 *
 * 定义已**下沉至 core 侧** `core/errorCodes.ts`：该表为纯数据、零依赖，却被 core 侧
 * 模块系统（`modules/*`）直接引用 ⇒ 原位置构成 core → infra 倒挂（A 类台账，
 * 见 .trae/specs/layer-inversion-a-class-inventory.md §3.5.1）。
 * 本文件保留同名导出 ⇒ `@modules/error` 与 `@modules/error/ErrorCodes` 对外符号逐字不变。
 */

export { ErrorCodes } from '../core/errorCodes.js';
export type {
  ErrorCodeDef,
  ErrorCodeKey,
  ErrorCodeValue,
} from '../core/errorCodes.js';
