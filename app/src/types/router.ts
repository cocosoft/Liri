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
 * 路由层级词汇表（core 层自持，纯类型）
 *
 * G1 收口（台账 D-59）：原定义于 `ai/router/types.ts`（app 层），
 * 而当时位于 core 的 `BootPipelineIntegrator` 亦需该类型 ⇒ 定义下沉至 core 层 types 模块，
 * 由上层 `ai/router/types.ts` 转出（app → core 合法），消除 core → app 倒挂。
 *
 * 沿革（2026-09-30，台账 D-82）：`BootPipelineIntegrator` 已随启动管道**整目录搬迁**到 entry 层
 * （`bootstrap/pipeline/`）⇒ "core 侧需要它"这一条理由已消失。该类型**仍留在 core**（纯类型、
 * 零依赖，归 core 的 `types` 模块是本仓既定口径），**本次不回迁**（回迁只会重新引入同类边）。
 */
export type RouterTier = 'simple' | 'medium' | 'complex' | 'reasoning';
