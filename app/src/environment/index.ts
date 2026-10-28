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
 * environment — **环境解析层**（infra · zone: environment，v3 方案 §6.2 P1 批次 4）
 *
 * 目录解析（`paths`）与由其派生的媒体根常量（`mediaRoots`）从内核整体迁入。
 *
 * 为什么是**整体迁出**而不是方案 §6.1/AC-09 设想的「paths.pure 留 core、paths.fs 迁 infra」：
 * 实测该前提不成立 —— 绝大多数“纯字符串”解析器都**间接**依赖环境探测：
 *   `resolveDataDir → resolvePyappHome`（`os.homedir()`）、
 *   `resolveDocsDir → resolveProjectRoot`（`existsSync/readFileSync` 判 `app/package.json`）。
 * 二者是**一条链**，切分只能靠“宿主注入 home/projectRoot”的依赖倒置，属语义改动；
 * 且批次 1–3 之后内核**已无** paths 消费者（唯一消费者 `mediaRoots` 本身也是派生常量）。
 * ⇒ 按「同一符号只能一份实现」（AC-06）与「core 不藏实现」（AC-01），整体落在 infra，
 * 函数体一行未改（行为等价，路径解析时机不变）。
 *
 * 若将来内核确实需要路径计算，再按 AC-09 原意补**注入式**的 `core/paths` 纯子集 ——
 * 那时才有真实消费者，也才值得为注入改语义。
 *
 * ⚠️ 本模块会被启动面（`main.ts` / `bootstrap`）静态加载 ⇒ 新增导出前先跑 `lint:startup-graph`。
 */

export * from './paths';
export * from './mediaRoots';
