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
 * A2A 协议数据模型 —— **转出层**（H5-③ 收口，台账 D-204）
 *
 * 定义已**下沉**至 core 层 types 模块（`types/a2a.ts`，零出向依赖），
 * 本文件仅**原址转出**（对外导出名与形状逐字不变）。
 *
 * 原因：`infrastructure/http/handlers/routes/a2a-routes.ts` 需要 `A2AArtifact` /
 * `A2AMessage` 等协议类型，而 service 不得依赖 app 层（门禁连类型导入也计）
 * ⇒ 定义归 core，app 层转出（同 D-67 / D-203 手法）。
 *
 * @see ../../types/a2a.ts 规范定义
 */
export * from '@modules/types/a2a';
