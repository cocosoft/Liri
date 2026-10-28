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
 * security/identity — **身份化存储策略**（infra · zone: control，v3 §6.1 P2）
 *
 * 从内核迁出的两个**策略**实现：
 * - `storageScope`：按身份（租户/用户）派生存储分区根与 db 路径；
 * - `sessionOwnership`：会话归属判定（谁能访问哪个会话）。
 *
 * 为什么它们出 core：二者是「谁被允许用哪块存储」的**策略**（Q2：契约在 core，判定点落
 * infra/control），且实现会随多租户策略调整而变；同时它们**零 I/O**（仅 `node:crypto` /
 * `node:path` + 内核的 `principal` / `requestScope` 契约）⇒ 迁移零行为变更。
 *
 * 留在 core 的是**契约与机制**：`identity/principal`（主体模型）、`identity/requestScope`
 * （请求作用域，`AsyncLocalStorage`）、`identity/scopedResources`（只记账、不碰 IO 的资源登记表）。
 */

export * from './storageScope';
export * from './sessionOwnership';
