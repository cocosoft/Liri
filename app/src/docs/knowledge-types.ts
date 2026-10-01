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
 * 知识搜索通用类型 —— **原址转出**
 *
 * 2026-10-01 D-167（`R00-001` 倒挂收口）：类型本体已**下沉 `core/knowledge-types.ts`**
 * （原因：`memory`(infra) 需要它们 ⇒ 留在 `docs`(app) 会构成 infra -> app 倒挂；该文件
 * 零 import、纯类型 ⇒ 理想的 core 叶子）。**本文件保留为转出**，以免改动既有多处消费方
 * （`docs` 自身与 `knowledge` 域等）。新代码可直接引用 `@modules/core/knowledge-types`。
 */

export * from '@modules/core/knowledge-types';
